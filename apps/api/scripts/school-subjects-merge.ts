/**
 * Слияние регистровых дублей карточек предмета школы (AR-201; дефект импорта
 * 2026-09-03: «алгебра» и «Алгебра» заведены как два предмета) — платформенная
 * операция без экрана, парная к `school-import.ts` и `school-schedule-clear.ts`.
 *
 * Дубль — вторая карточка того же класса с тем же ключом имени
 * (`subjectNameKey`: trim, пробелы в один, нижний регистр, «ё» → «е»). Канон —
 * карточка с бóльшим числом привязок, затем с уроками, затем старшая; имя канона
 * приводится к каноническому (`canonicalSubjectName`: пресет либо первая буква
 * заглавной). Пара сливается ОДНОЙ транзакцией: привязки педагогов переезжают
 * (одинаковые сливаются, часы — максимум), слоты сетки, уроки, колонки журнала и
 * токены привязки перепривязываются по значению, `priority` — ИЛИ, дубль
 * удаляется, версия сетки поднимается. Отметки и темы уроков живут на колонках
 * журнала и не трогаются. Д6-конфликт «весь класс» ↔ группы между дублями
 * автоматически не решается — пара печатается и пропускается.
 *
 * Событий не издаёт (иначе `subject.card.deleted.v1` уронил бы сетку в stale) —
 * след операции: лог прогона workflow и строка в docs/PROD-STATUS.md.
 *
 *   npm --workspace apps/api run subjects:merge -- --workspace=<id>          — dry-run: пары и план, ничего не пишет
 *   npm --workspace apps/api run subjects:merge -- --workspace=<id> --apply  — исполнить
 */
import { PrismaClient } from '@prisma/client';
import { describePlan, findDuplicateGroups, mergeSubjectPair } from '../src/schoolium/subjects/subject-merge';

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? '' : undefined;
};

async function main(): Promise<void> {
  const wsArg = arg('workspace');
  const apply = arg('apply') !== undefined;
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  const ws = workspaces.find((w) => w.id === wsArg);
  if (!ws) {
    console.error('укажите --workspace=<id> из списка:');
    for (const w of workspaces) console.error(`  ${w.id} · ${w.name}`);
    process.exit(3);
  }

  const groups = await findDuplicateGroups(prisma, ws.id);
  const pairs = groups.reduce((n, g) => n + g.dups.length, 0);
  console.log(`Школа: ${ws.name} (${ws.id}) · режим: ${apply ? 'APPLY — изменения пишутся' : 'dry-run — только план'}`);
  console.log(`Ключей с дублями: ${groups.length}, пар к слиянию: ${pairs}`);
  if (!pairs) {
    console.log('Дублей нет — делать нечего.');
    return;
  }

  let merged = 0;
  let skipped = 0;
  for (const g of groups) {
    console.log(
      `\n${g.classLabel} · ключ «${g.nameKey}»: канон «${g.canon.name}» (привязок ${g.canon.bindings}, уроков ${g.canon.lessons})` +
        ` ← дубли: ${g.dups.map((d) => `«${d.name}» (привязок ${d.bindings}, уроков ${d.lessons})`).join(', ')}`,
    );
    for (const dup of g.dups) {
      const r = await mergeSubjectPair(prisma, ws.id, g.canon.id, dup.id, { dryRun: !apply });
      for (const line of describePlan(g, dup, r)) console.log('  ' + line);
      if (r.ok) merged += 1;
      else skipped += 1;
    }
  }

  console.log(
    `\n${apply ? 'Слито' : 'К слиянию'}: ${merged} пар; пропущено (решает человек): ${skipped}.` +
      (apply ? ' Версия сетки поднята — открытые экраны расписания перечитают данные.' : ' Исполнить: тот же запуск с --apply.'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
