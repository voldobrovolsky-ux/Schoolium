/**
 * Заведение учёток школы (AR-93, AR-148, AR-154) — ПЛАТФОРМЕННАЯ операция без
 * экрана, парная к `school-bootstrap.ts`: та создаёт школу с нуля, эта — доводит
 * СУЩЕСТВУЮЩУЮ школу до рабочих кабинетов, не трогая ничего, кроме учёток.
 *
 * Что делает (идемпотентно, только добавляет):
 *   1. находит школу: `--workspace=<id>`, а при единственной — сам;
 *   2. печатает существующий персонал (кто уже заведён, с ролями);
 *   3. `--admin-name/--admin-username` — учётка администратора школы
 *      (roles `admin`+`moderator`, как у оператора bootstrap);
 *   4. `--moderator-name/--moderator-username` — учётка модератора школы;
 *   5. `--deputy-name/--deputy-username` — учётка завуча (1.3.0, AR-186:
 *      роль `deputy_academic`, карточка секции «Заместители», кабинет `S-61`);
 *   6. каждой созданной или найденной учётке перевыпускает ОДНОРАЗОВУЮ ссылку
 *      входа (48 ч, `purpose = bootstrap`, AR-189) и печатает её; новой —
 *      печатает и креды (один раз). Вход по ссылке активирует учётку (AR-161).
 *
 * Существующая учётка (по юзернейму) НЕ пересоздаётся: роли дополняются до
 * запрошенных, пароль не трогается, ссылка перевыпускается.
 *
 *   npm --workspace apps/api run school:provision -- \
 *     --admin-name="Фамилия Имя" --admin-username=vol \
 *     --moderator-name="Иванова Оксана" --moderator-username=veles \
 *     --deputy-name="Сидорова Елена" --deputy-username=elena
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ACCESS_PARAMS, usernameProblem, type SchoolRole } from '@edustore/shared';
import { generatePassword, hashPassword } from '../src/schoolium/staff/credentials';

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? '' : undefined;
};

const HOUR = 3600 * 1000;

/** Платформенная ссылка: `purpose = bootstrap`, без `issuedBy` — выпущена консолью, а не администратором (AR-189). */
async function issueLink(workspaceId: string, userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await prisma.bootstrapLink.create({
    data: {
      workspaceId,
      userId,
      token,
      purpose: 'bootstrap',
      expiresAt: new Date(Date.now() + ACCESS_PARAMS.loginLinkTtlHours * HOUR),
    },
  });
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  return `${base}/bootstrap/${token}`;
}

async function ensure(
  workspaceId: string,
  roles: SchoolRole[],
  displayName: string,
  rawUsername: string,
  card: { section: number; plannedRoles: SchoolRole[] } = { section: 1, plannedRoles: roles.filter((r) => r === 'moderator') },
): Promise<string[]> {
  // Юзернейм — как его примет форма входа (S-05′): без пробелов и в нижнем
  // регистре; иначе `Vol ` заведёт учётку, в которую нельзя войти.
  const username = rawUsername.trim().toLowerCase();
  const problem = usernameProblem(username);
  if (problem) {
    console.error(
      problem === 'reserved'
        ? `юзернейм «${username}» зарезервирован — выберите другой`
        : `юзернейм «${username}» недопустим: 3–30 знаков, только латиница в нижнем регистре, цифры и _`,
    );
    process.exit(3);
  }
  const [lastName, firstName] = displayName.split(/\s+/);
  let user = await prisma.user.findUnique({ where: { username } });
  let creds = 'креды прежние — учётка уже существовала, пароль не тронут';
  if (!user) {
    const password = generatePassword();
    user = await prisma.user.create({
      data: {
        id: `u-${randomUUID()}`,
        lastName: lastName ?? displayName,
        firstName: firstName ?? '',
        displayName,
        username,
        passwordHash: hashPassword(password),
      },
    });
    creds = `юзернейм ${username} · пароль ${password} (показан один раз — резервный вход)`;
  }
  const membership = await prisma.membership.findFirst({ where: { userId: user.id, workspaceId } });
  if (!membership) {
    await prisma.membership.create({
      data: { florusUserId: user.id, userId: user.id, workspaceId, florusRole: 'staff', roles },
    });
  } else {
    const merged = [...new Set([...membership.roles, ...roles])];
    if (merged.length !== membership.roles.length) {
      await prisma.membership.update({ where: { id: membership.id }, data: { roles: merged } });
    }
  }
  const existing = await prisma.staffCard.findFirst({ where: { workspaceId, userId: user.id } });
  if (!existing) {
    await prisma.staffCard.create({
      data: { workspaceId, section: card.section, plannedRoles: card.plannedRoles, userId: user.id, seq: 0 },
    });
  }
  const url = await issueLink(workspaceId, user.id);
  return [
    `— ${displayName} (@${username}) · роли: ${roles.join(', ')}`,
    `  ${creds}`,
    `  одноразовая ссылка входа (${ACCESS_PARAMS.loginLinkTtlHours} ч): ${url}`,
  ];
}

async function main(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  if (!workspaces.length) {
    console.error('школ нет — сначала school:bootstrap');
    process.exit(3);
  }
  const wsArg = arg('workspace');
  const ws = wsArg ? workspaces.find((w) => w.id === wsArg) : workspaces.length === 1 ? workspaces[0] : undefined;
  if (!ws) {
    console.error('школ несколько — укажите --workspace=<id>:');
    for (const w of workspaces) console.error(`  ${w.id} · ${w.name}`);
    process.exit(3);
  }

  const members = await prisma.membership.findMany({ where: { workspaceId: ws.id, florusRole: 'staff' } });
  const memberIds = members.map((m) => m.userId).filter((x): x is string => x !== null);
  const users = await prisma.user.findMany({ where: { id: { in: memberIds } } });
  const out: string[] = [`Школа: ${ws.name} (workspace ${ws.id})`, `Персонал с учётками (${members.length}):`];
  for (const m of members) {
    const u = users.find((x) => x.id === m.userId);
    out.push(`  · ${u?.displayName ?? m.userId} (@${u?.username ?? '—'}) — ${m.roles.join(', ')}${m.deactivatedAt ? ' [деактивирован]' : ''}`);
  }

  const adminName = arg('admin-name');
  const adminUsername = arg('admin-username');
  if (adminName && adminUsername) {
    out.push('', 'Администратор школы:');
    out.push(...(await ensure(ws.id, ['admin', 'moderator'], adminName, adminUsername)));
  }
  const modName = arg('moderator-name');
  const modUsername = arg('moderator-username');
  if (modName && modUsername) {
    out.push('', 'Модератор школы:');
    out.push(...(await ensure(ws.id, ['moderator'], modName, modUsername)));
  }
  const depName = arg('deputy-name');
  const depUsername = arg('deputy-username');
  if (depName && depUsername) {
    out.push('', 'Завуч (заместитель по учебной работе):');
    // Секция 2 — «Заместители» (S-30); `plannedRoles` пусты: роль живёт в
    // членстве, а карточка с учёткой не является слотом (AR-182).
    out.push(...(await ensure(ws.id, ['deputy_academic'], depName, depUsername, { section: 2, plannedRoles: [] })));
  }
  console.log(out.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
