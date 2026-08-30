/**
 * Bootstrap школы (AR-93, AR-98) — ПЛАТФОРМЕННАЯ операция, экрана у неё нет и не
 * будет: у графа онбординга должен быть корень, но корень заводит тот, кто
 * продаёт школе продукт, а не сама школа.
 *
 * Создаёт `Workspace`, `User` и членство модератора по номеру телефона и печатает
 * ОДНОРАЗОВУЮ ссылку входа на 24 часа. Та же команда перевыпускает ссылку, если
 * единственный модератор остался без единой живой сессии, — школа не запирается
 * навсегда.
 *
 * `Workspace.orgId → Organization` — обязательная связь (AR-104), поэтому команда
 * создаёт не только школу: без `Organization` школа не вставляется вовсе.
 *
 * Дефолтной школы в коде нет (AR-98): вторая школа — это второй прогон этой
 * команды без единой правки кода.
 *
 *   npm --workspace apps/api run school:bootstrap -- --phone=+79990000000 --school="Школа №1" --name="Иванова Мария"
 *   npm --workspace apps/api run school:bootstrap -- --phone=+79990000000 --relink
 *
 * 1.2.0 (AR-154/AR-156): оператору заводятся и КРЕДЫ — юзернейм (--username или
 * транслитерация имени) и пароль (--password или генерация). Печатаются один
 * раз: это резервный вход при слетевшей сессии, основной вход — ссылка/QR.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ACCESS_PARAMS } from '@edustore/shared';
import { generatePassword, hashPassword, resolveUsername } from '../src/schoolium/staff/credentials';

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? '' : undefined;
};

const HOUR = 3600 * 1000;

async function issueLink(workspaceId: string, userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await prisma.bootstrapLink.create({
    data: {
      workspaceId,
      userId,
      token,
      expiresAt: new Date(Date.now() + ACCESS_PARAMS.bootstrapLinkTtlHours * HOUR),
    },
  });
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  return `${base}/bootstrap/${token}`;
}

async function main(): Promise<void> {
  const phone = (arg('phone') ?? '').replace(/[^\d+]/g, '');
  if (!phone) {
    console.error('нужен --phone=<номер>: телефон — идентичность пользователя (AR-46)');
    process.exit(2);
  }
  const relink = arg('relink') !== undefined;

  if (relink) {
    // Перевыпуск ссылки: единственный модератор потерял телефон и не имеет ни
    // одной живой сессии (AR-93). Платформа выпускает новую одноразовую ссылку.
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      console.error(`пользователь с телефоном ${phone} не найден`);
      process.exit(3);
    }
    const m = await prisma.membership.findFirst({ where: { userId: user.id, roles: { has: 'moderator' } } });
    if (!m) {
      console.error('у пользователя нет членства с ролью модератора — перевыпускать нечего');
      process.exit(3);
    }
    const url = await issueLink(m.workspaceId, user.id);
    console.log(`Ссылка перевыпущена (одноразовая, ${ACCESS_PARAMS.bootstrapLinkTtlHours} ч):\n${url}`);
    return;
  }

  const schoolName = arg('school');
  const displayName = arg('name') ?? 'Модератор школы';
  if (!schoolName) {
    console.error('нужен --school="<название школы>"');
    process.exit(2);
  }

  // Organization — платформа EduStore, одна на инсталляцию; Workspace = школа.
  const org =
    (await prisma.organization.findFirst({ where: { type: 'platform' } })) ??
    (await prisma.organization.create({ data: { name: 'EduStore', type: 'platform' } }));

  const workspace = await prisma.workspace.create({
    data: { orgId: org.id, name: schoolName, sector: 'private' },
  });

  const existing = await prisma.user.findUnique({ where: { phone } });
  const [lastName, firstName] = displayName.split(/\s+/);
  // 1.2.0: креды оператора — резервный вход (AR-156); у существующей учётки
  // не трогаются (перевыпуск — с карточки в кабинете)
  let credentialsNote = 'креды прежние — перевыпуск пароля доступен с карточки';
  let user = existing;
  if (!user) {
    const username = await resolveUsername(prisma, arg('username'), {
      lastName: lastName ?? displayName,
      firstName: firstName ?? '',
    });
    const password = arg('password') || generatePassword();
    user = await prisma.user.create({
      data: {
        id: `u-${randomUUID()}`,
        phone,
        lastName: lastName ?? displayName,
        firstName: firstName ?? '',
        displayName,
        username,
        passwordHash: hashPassword(password),
      },
    });
    credentialsNote = `юзернейм ${username} · пароль ${password} (показан один раз — резервный вход)`;
  }

  await prisma.membership.create({
    data: {
      florusUserId: user.id,
      userId: user.id,
      workspaceId: workspace.id,
      florusRole: 'staff', // legacy-колонка контура КТП; роли версии — в roles[]
      roles: ['admin', 'moderator'], // AR-148/AR-152: оператор школы несёт обе роли
    },
  });
  // карточка модератора на экране «Персонал» — секция 1, роль уже действующая
  await prisma.staffCard.create({
    data: { workspaceId: workspace.id, section: 1, plannedRoles: ['moderator'], userId: user.id, seq: 0 },
  });
  await prisma.schoolState.create({ data: { workspaceId: workspace.id } });

  const url = await issueLink(workspace.id, user.id);
  console.log(
    [
      `Школа создана: ${schoolName} (workspace ${workspace.id})`,
      `Модератор: ${displayName}, телефон ${phone}`,
      `Креды: ${credentialsNote}`,
      `Одноразовая ссылка входа (${ACCESS_PARAMS.bootstrapLinkTtlHours} ч) — передайте директору лично:`,
      url,
    ].join('\n'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
