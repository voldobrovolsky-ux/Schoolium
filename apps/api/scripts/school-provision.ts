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
 *   5. каждой созданной или найденной учётке перевыпускает ОДНОРАЗОВУЮ ссылку
 *      входа (24 ч) и печатает её; новой — печатает и креды (один раз).
 *
 * Существующая учётка (по юзернейму) НЕ пересоздаётся: роли дополняются до
 * запрошенных, пароль не трогается, ссылка перевыпускается.
 *
 *   npm --workspace apps/api run school:provision -- \
 *     --admin-name="Фамилия Имя" --admin-username=vol \
 *     --moderator-name="Иванова Оксана" --moderator-username=veles
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ACCESS_PARAMS, type SchoolRole } from '@edustore/shared';
import { generatePassword, hashPassword } from '../src/schoolium/staff/credentials';

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
    data: { workspaceId, userId, token, expiresAt: new Date(Date.now() + ACCESS_PARAMS.bootstrapLinkTtlHours * HOUR) },
  });
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  return `${base}/bootstrap/${token}`;
}

async function ensure(
  workspaceId: string,
  roles: SchoolRole[],
  displayName: string,
  username: string,
): Promise<string[]> {
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
  const card = await prisma.staffCard.findFirst({ where: { workspaceId, userId: user.id } });
  if (!card) {
    await prisma.staffCard.create({
      data: { workspaceId, section: 1, plannedRoles: roles.filter((r) => r === 'moderator'), userId: user.id, seq: 0 },
    });
  }
  const url = await issueLink(workspaceId, user.id);
  return [
    `— ${displayName} (@${username}) · роли: ${roles.join(', ')}`,
    `  ${creds}`,
    `  одноразовая ссылка входа (${ACCESS_PARAMS.bootstrapLinkTtlHours} ч): ${url}`,
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
  console.log(out.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
