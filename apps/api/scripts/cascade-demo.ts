/**
 * Демонстрация и проверка событийного фундамента системы параметров:
 *   каскад «зачисление ученика» + идемпотентность + depth-guard (защита от петель).
 * Запуск: npm run cascade:demo  (нужен поднятый Postgres + сид).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { EventBus } from '../src/common/events/event-bus';
import { newEvent, type DomainEvent } from '../src/common/events/domain-event';
import { ContingentService } from '../src/parameters/contingent/contingent.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const dispatcher = app.get(OutboxDispatcher);
  const bus = app.get(EventBus);
  const contingent = app.get(ContingentService);

  const klass = await prisma.class.findFirst({ where: { label: '8А' } });
  if (!klass) throw new Error('Сначала выполните сид (npm run seed)');

  const before = {
    mem: await prisma.channelMembership.count(),
    meal: await prisma.mealOrder.count(),
  };

  console.log('\n══════ КАСКАД: зачисление ученика ══════');
  const student = await contingent.enrollStudent({
    classId: klass.id,
    firstName: 'Тест',
    lastName: 'Новиков',
  });
  console.log('создан ученик:', student.displayName);
  await dispatcher.drain();

  const enrolled = await prisma.outboxEvent.findFirst({
    where: { type: 'contingent.student.enrolled.v1' },
    orderBy: { createdAt: 'desc' },
  });
  const cascade = await prisma.outboxEvent.findMany({
    where: { correlationId: enrolled!.correlationId },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nцепочка событий (correlationId =', enrolled!.correlationId, '):');
  for (const e of cascade) console.log(`  depth=${e.depth}  ${e.type}  [${e.status}]`);
  console.log(
    '\nпобочные эффекты: +членств канала =',
    (await prisma.channelMembership.count()) - before.mem,
    '| +заявок питания =',
    (await prisma.mealOrder.count()) - before.meal,
  );

  console.log('\n══════ ИДЕМПОТЕНТНОСТЬ: повторная публикация того же события ══════');
  const memBefore = await prisma.channelMembership.count();
  const replay: DomainEvent = {
    id: enrolled!.id,
    type: enrolled!.type,
    occurredAt: enrolled!.createdAt.toISOString(),
    workspaceId: enrolled!.workspaceId,
    correlationId: enrolled!.correlationId,
    causationId: enrolled!.causationId,
    depth: enrolled!.depth,
    actor: enrolled!.actor,
    payload: enrolled!.payload,
  };
  await bus.publish(replay);
  console.log(
    '+членств после повторной публикации =',
    (await prisma.channelMembership.count()) - memBefore,
    '(ожидается 0 — дубль отброшен inbox)',
  );

  console.log('\n══════ DEPTH-GUARD: событие глубиной 13 (> MAX=12) ══════');
  await bus.publish(
    newEvent({
      type: 'contingent.student.enrolled.v1',
      workspaceId: klass.workspaceId,
      depth: 13,
      payload: { studentId: 'x', classId: klass.id, displayName: 'Петля', number: 0 },
    }),
  );
  console.log('(ожидается строка DROP … > MAX в логе шины — петля каскада заблокирована)');

  await app.close();
  console.log('\n✓ фундамент работает.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
