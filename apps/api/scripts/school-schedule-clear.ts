/**
 * Очистка ОШИБОЧНОЙ сетки расписания школы (решение владельца 2026-08-31:
 * «очисти расписание, пусть работает генератор») — платформенная операция без
 * экрана, парная к `school-import.ts`: импорт сетку занёс, эта — убирает её,
 * не трогая НИЧЕГО, кроме расписания и производных от него уроков.
 *
 * Что делает (только по --workspace, вслепую по единственной школе не бьёт):
 *   1. уроки БЕЗ отметок — удаляются вместе с колонками журнала;
 *   2. уроки С отметками — отвязываются (`detachedAt`), отметки живы (AR-85);
 *   3. шаблоны сетки удаляются (слоты каскадом), S-40 возвращается к
 *      «Расписание ещё не настроено»;
 *   4. классы, предметы, привязки, нагрузка, ученики НЕ трогаются — сетку
 *      пересоберёт генератор по ним.
 *
 *   npm --workspace apps/api run schedule:clear -- --workspace=<id>
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

async function main(): Promise<void> {
  const wsArg = arg('workspace');
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  const ws = workspaces.find((w) => w.id === wsArg);
  if (!ws) {
    console.error('укажите --workspace=<id> из списка:');
    for (const w of workspaces) console.error(`  ${w.id} · ${w.name}`);
    process.exit(3);
  }

  const lessons = await prisma.schoolLesson.findMany({ where: { workspaceId: ws.id }, select: { id: true } });
  const ids = lessons.map((l) => l.id);
  const marked = new Set(
    (await prisma.mark.findMany({ where: { lessonId: { in: ids } }, select: { lessonId: true } })).map((m) => m.lessonId),
  );
  const plain = ids.filter((id) => !marked.has(id));
  const kept = ids.filter((id) => marked.has(id));

  const now = new Date();
  // Уроки с отметками — detach, не удаление: отметки принадлежат людям (AR-85).
  if (kept.length) {
    await prisma.schoolLesson.updateMany({ where: { id: { in: kept } }, data: { detachedAt: now } });
    await prisma.journalColumn.updateMany({ where: { lessonId: { in: kept } }, data: { detachedAt: now } });
  }
  // Пустые уроки и их колонки — вон (каскад уносит темы; отметок нет по отбору).
  const cols = await prisma.journalColumn.deleteMany({ where: { workspaceId: ws.id, lessonId: { in: plain } } });
  const gone = await prisma.schoolLesson.deleteMany({ where: { id: { in: plain } } });
  const tpls = await prisma.scheduleTemplate.deleteMany({ where: { workspaceId: ws.id } });
  // Версия агрегата двигается, чтобы открытые экраны не сохранили старое поверх.
  await prisma.schoolState.updateMany({ where: { workspaceId: ws.id }, data: { scheduleVersion: { increment: 1 } } });

  console.log(
    [
      `Школа: ${ws.name} (${ws.id})`,
      `Шаблонов сетки удалено: ${tpls.count}`,
      `Уроков удалено: ${gone.count} (колонок журнала: ${cols.count})`,
      `Уроков с отметками отвязано: ${kept.length}`,
      'Классы, предметы, привязки, нагрузка и ученики не тронуты.',
    ].join('\n'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
