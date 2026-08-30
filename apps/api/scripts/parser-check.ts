/**
 * e2e парсера учебников (Документохранилище_ТЗ / договорённость): doc.file.enriched → textbook.parsed.
 * Поднимает реальный Nest-контекст (тот же EventBus + tenant-guard) и прогоняет:
 *  1) смоковое обогащение (File+Material с textExtract) → drain → парсер эмитит textbook.parsed;
 *  2) payload несёт fileId (НЕ s3Key), темы/карты не пустые;
 *  3) не-учебник (File без Material) → парсер тихо игнорирует;
 *  4) пустой textExtract → деградация (парсер не запускается);
 *  5) tenant-изоляция новых таблиц (TextbookTopic) A↔B.
 * S3 не нужен: обогащение эмулируется (ключи в dev пустые — реальный upload идёт при настроенном S3).
 * Запуск: npm run parser:check  (нужен поднятый Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { newEvent } from '../src/common/events/domain-event';
import { DOC_EVENTS, type FileEnrichedV1 } from '../src/modules/doc/doc.contract';
import { TEXTBOOK_EVENTS, type TextbookParsedV1 } from '../src/modules/textbook/textbook.contract';

const WS = 'parser-test-ws';
const WS_B = 'parser-test-ws-b';
const DISC = 'disc-geom';
const SAMPLE = [
  'Глава 1. Векторы',
  '§ 1. Понятие вектора',
  'Вектор — направленный отрезок. Длина вектора — его модуль.',
  '§ 2. Сложение векторов',
  'Правило треугольника и правило параллелограмма.',
  'Глава 2. Метод координат',
  '§ 3. Координаты вектора',
  'Разложение вектора по координатным осям.',
  '§ 4. Простейшие задачи в координатах',
  'Координаты середины отрезка; длина вектора.',
].join('\n');

async function cleanup(prisma: PrismaService) {
  await TenantContext.runAsSystem(async () => {
    for (const ws of [WS, WS_B]) {
      await prisma.textbookCard.deleteMany({ where: { workspaceId: ws } });
      await prisma.textbookTopic.deleteMany({ where: { workspaceId: ws } });
      await prisma.material.deleteMany({ where: { workspaceId: ws } });
      await prisma.file.deleteMany({ where: { workspaceId: ws } });
      await prisma.outboxEvent.deleteMany({ where: { workspaceId: ws } });
      await prisma.workspace.deleteMany({ where: { id: ws } });
    }
  });
}

/** Смоковое обогащение: создать File(enriched,textExtract) + опц. Material, эмитить doc.file.enriched. */
async function seedEnriched(
  prisma: PrismaService,
  outbox: OutboxService,
  opts: { ws: string; fileId: string; s3Key: string; textExtract: string | null; withMaterial: boolean },
) {
  await TenantContext.runAsSystem(async () => {
    await prisma.file.create({
      data: {
        id: opts.fileId,
        workspaceId: opts.ws,
        s3Key: opts.s3Key,
        ownerId: 'teacher-1',
        scope: 'школа',
        disciplineId: DISC,
        mime: 'application/pdf',
        textExtract: opts.textExtract,
        state: 'enriched',
      },
    });
    if (opts.withMaterial) {
      await prisma.material.create({
        data: { workspaceId: opts.ws, fileId: opts.fileId, disciplineId: DISC, uploadedBy: 'teacher-1' },
      });
    }
    // событие обогащения из хранилища (payload несёт textExtract — парсер его переиспользует)
    await prisma.$transaction((tx) =>
      outbox.enqueue(
        tx,
        newEvent<FileEnrichedV1>({
          type: DOC_EVENTS.fileEnriched,
          workspaceId: opts.ws,
          payload: { fileId: opts.fileId, textExtract: opts.textExtract, tags: [] },
        }),
      ),
    );
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const outbox = app.get(OutboxService);
  const dispatcher = app.get(OutboxDispatcher);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };

  await cleanup(prisma);
  await TenantContext.runAsSystem(async () => {
    await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    for (const ws of [WS, WS_B]) {
      await prisma.workspace.create({ data: { id: ws, orgId: 'org-edustore-platform', name: `Test ${ws}` } });
    }
  });

  // ── 1) учебник: File+Material+textExtract → drain → парсер разбирает и эмитит textbook.parsed ──
  const fileId = 'file-textbook-1';
  const s3Key = `docs/${WS}/textbook-1.pdf`;
  await seedEnriched(prisma, outbox, { ws: WS, fileId, s3Key, textExtract: SAMPLE, withMaterial: true });
  await dispatcher.drain();

  const [topics, cards] = await TenantContext.run({ tenantId: WS, system: false }, async () => [
    await prisma.textbookTopic.findMany({ where: { fileId }, orderBy: { order: 'asc' } }),
    await prisma.textbookCard.findMany({ where: { fileId }, orderBy: { order: 'asc' } }),
  ]);
  check('темы разобраны (не пусто)', topics.length === 2);
  check('карты разобраны (не пусто)', cards.length === 4);
  check('карта привязана к теме (topicId проставлен)', cards.every((c) => c.topicId));

  // textbook.parsed эмитировано; payload несёт fileId (НЕ s3Key)
  const parsedEvt = await TenantContext.runAsSystem(() =>
    prisma.outboxEvent.findFirst({ where: { type: TEXTBOOK_EVENTS.parsed, workspaceId: WS }, orderBy: { createdAt: 'desc' } }),
  );
  const payload = parsedEvt?.payload as unknown as TextbookParsedV1 | undefined;
  check('textbook.parsed эмитировано', !!payload);
  check('payload.fileId === fileId (не s3Key)', payload?.fileId === fileId && payload?.fileId !== (s3Key as string));
  check('payload не содержит s3Key', payload ? !('s3Key' in (payload as object)) : false);
  check('payload.topics/cards не пустые', (payload?.topics.length ?? 0) === 2 && (payload?.cards.length ?? 0) === 4);
  check('payload.materialId проставлен', !!payload?.materialId);

  // идемпотентность: повторное обогащение того же файла не плодит дубли
  await seedEnriched(prisma, outbox, { ws: WS, fileId: `${fileId}-dup`, s3Key, textExtract: SAMPLE, withMaterial: false });
  // эмулируем повторное событие по уже разобранному fileId
  await TenantContext.runAsSystem(() =>
    prisma.$transaction((tx) =>
      outbox.enqueue(tx, newEvent<FileEnrichedV1>({ type: DOC_EVENTS.fileEnriched, workspaceId: WS, payload: { fileId, textExtract: SAMPLE, tags: [] } })),
    ),
  );
  await dispatcher.drain();
  const topicsAfter = await TenantContext.run({ tenantId: WS, system: false }, () => prisma.textbookTopic.count({ where: { fileId } }));
  check('идемпотентность: повтор не дублирует темы', topicsAfter === 2);

  // ── 3) не-учебник: File без Material → парсер тихо игнорирует ──
  const orphanId = 'file-not-textbook';
  await seedEnriched(prisma, outbox, { ws: WS, fileId: orphanId, s3Key: `docs/${WS}/x.pdf`, textExtract: SAMPLE, withMaterial: false });
  await dispatcher.drain();
  const orphanTopics = await TenantContext.run({ tenantId: WS, system: false }, () => prisma.textbookTopic.count({ where: { fileId: orphanId } }));
  check('не-учебник (нет Material) → парсер молчит (0 тем)', orphanTopics === 0);

  // ── 4) деградация: Material есть, но textExtract пуст → парсер не запускается ──
  const emptyId = 'file-empty-extract';
  await seedEnriched(prisma, outbox, { ws: WS, fileId: emptyId, s3Key: `docs/${WS}/e.pdf`, textExtract: null, withMaterial: true });
  await dispatcher.drain();
  const emptyTopics = await TenantContext.run({ tenantId: WS, system: false }, () => prisma.textbookTopic.count({ where: { fileId: emptyId } }));
  check('пустой textExtract → деградация (0 тем, без падения)', emptyTopics === 0);

  // ── 5) tenant-изоляция новых таблиц: разбор в B, чтение в A ──
  const fileB = 'file-textbook-b';
  await seedEnriched(prisma, outbox, { ws: WS_B, fileId: fileB, s3Key: `docs/${WS_B}/tb.pdf`, textExtract: SAMPLE, withMaterial: true });
  await dispatcher.drain();
  const topicB = await TenantContext.runAsSystem(() => prisma.textbookTopic.findFirst({ where: { workspaceId: WS_B } }));
  const isolation = await TenantContext.run({ tenantId: WS, system: false }, async () => {
    const seen = await prisma.textbookTopic.findMany(); // guard → только WS
    const leak = topicB ? await prisma.textbookTopic.findUnique({ where: { id: topicB.id } }) : 'no-B';
    return { onlyOwn: seen.every((t) => t.workspaceId === WS) && seen.length > 0, leak };
  });
  check('TextbookTopic: A видит только свои', isolation.onlyOwn);
  check('TextbookTopic: чужой (B) id из A → null', isolation.leak === null);

  await cleanup(prisma);
  await app.close();
  console.log(`\n${fail === 0 ? '✓ ПАРСЕР OK' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
