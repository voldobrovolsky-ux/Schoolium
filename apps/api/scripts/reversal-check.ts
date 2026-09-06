/**
 * G-43 (AR-213, AR-89, AR-90, AR-78, AR-102, AR-182, AR-205) — **обратимость
 * операций и каскад разрушения.**
 *
 *   · у КАЖДОЙ операции реестра есть обратная либо записанная причина её
 *     отсутствия; необратимых пять, и каждая необратима по построению;
 *   · над сотрудником две разрушающие операции (AR-213), и различает их объём
 *     потери данных: отзыв активации сохраняет всё и обратим «Вернуть доступ»,
 *     удаление профиля стирает данные человека и проходит В ТОМ ЧИСЛЕ у
 *     сотрудника с историей — его отметки остаются записью школы;
 *   · каскад: привязки сняты, покрытие упало, сетка `stale`, выставленные им
 *     отметки ОСТАЛИСЬ — `postedBy` историческая ссылка, а не живая связь;
 *   · последнего активного модератора школа не теряет ни одной из двух операций
 *     (`LAST_MODERATOR`), последняя роль не снимается (`LAST_ROLE`);
 *   · роль модератора выдаётся и снимается той же кнопкой (AR-102);
 *   · лимит носителей роли (AR-205): по умолчанию завуч один — второй отклонён
 *     `ROLE_LIMIT_REACHED` и в `addCard`, и в `addRole`; лимит 2 из политики
 *     пускает второго и отклоняет третьего; реактивация при занятом лимите
 *     отклонена; пустой слот после удаления — тоже носитель.
 *
 * Запуск: npm --workspace apps/api run reversal:check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { AdminCabinetService } from '../src/schoolium/cabinets/admin-cabinet.service';
import { bench, check, ensurePastLesson, inSchool, makeStaff, readySchool, refuses, report } from './schoolium/harness';

/** Реестр обратимости — эталон `reversals` в `model/states.mjs` (свойство P12). */
function reversals(): { op: string; back: string; why: string }[] {
  const src = readFileSync(join(__dirname, '../../../specs/school-onboarding/model/states.mjs'), 'utf8');
  const block = src.slice(src.indexOf('export const reversals'), src.indexOf('// Удаление и деактивация сотрудника'));
  return [...block.matchAll(/\[\s*'([^']*)',\s*'([^']*)',\s*'((?:[^'\\]|\\.)*)'\s*\]/g)].map((m) => ({
    op: m[1],
    back: m[2],
    why: m[3],
  }));
}

async function main(): Promise<void> {
  const b = await bench();
  const staff = b.get(StaffService);
  const subjects = b.get(SubjectsService);
  const journal = b.get(JournalService);
  const state = b.get(SchoolStateService);
  const admin = b.get(AdminCabinetService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-43 · обратимость операций и каскад удаления (AR-89, AR-90, AR-205)\n');

  // ─── реестр обратимости: пустых пар нет ───
  const reg = reversals();
  check(reg.length >= 20, `реестр обратимости: ${reg.length} операций`);
  const mute = reg.filter((r) => !r.back && !r.why);
  check(mute.length === 0, mute.length === 0
    ? 'у каждой операции названа обратная либо ПРИЧИНА её отсутствия — пустых пар нет'
    : `операции без обратной и без причины: ${mute.map((r) => r.op).join(', ')}`);
  const irreversible = reg.filter((r) => !r.back);
  check(irreversible.length === 5,
    `необратимых операций ${irreversible.length}: ${irreversible.map((r) => r.op).join(' · ')} — их пять, не три (AR-105)`);
  for (const need of ['удалить класс', 'удалить предмет', 'удалить ученика', 'удалить профиль сотрудника', 'снять роль', 'открепить педагога']) {
    check(reg.some((r) => r.op === need), `разрушающая операция «${need}» стоит в реестре СВОЕЙ строкой (AR-105)`);
  }

  // ─── две разрушающие операции над сотрудником: каскад и обратимость (AR-213) ───
  const s = await readySchool(b, 'Школа персонала');
  await ensurePastLesson(b, s.workspaceId);
  await inSchool(s.workspaceId, async () => {
    const actor = { userId: s.teacher.userId, roles: ['teacher' as const], name: 'Иванова Мария' };
    const view = await journal.read(s.classId, s.subjectId, null);
    const past = view.columns.find((c) => !c.future);
    if (past) {
      await journal.postMark(past.lessonId, s.studentIds[0], '5', actor);
      await drain();
    }
    const marksBefore = await b.prisma.mark.count();
    check(marksBefore > 0, `педагог выставил отметок: ${marksBefore} — теперь у него есть история`);

    const card = await staff.get(s.teacher.cardId);
    check(card.hasHistory, 'сервер вернул hasHistory: true — им подтверждение назовёт объём потери (AR-105), а не подменит кнопку');

    // ── операция 1: отзыв активации — данные целы, право снято, обратима ──
    await staff.revokeActivation(s.teacher.cardId, s.moderator);
    await drain();
    const after = await staff.get(s.teacher.cardId);
    check(after.deactivated, 'отзыв активации закрыл доступ: право взаимодействовать со школой снято (AR-213)');
    check(!after.registered, 'карточка вернулась в «Не авторизованные» — тем же движением, а не второй кнопкой');
    check(after.name === card.name && after.username === card.username,
      'ФИО и логин на месте: отзыв активации не трогает ни одной записи о человеке');
    check((await b.prisma.mark.count()) === marksBefore,
      'выставленные им отметки остались — postedBy историческая ссылка, а не живая связь');
    check((await b.prisma.teacherBinding.count({ where: { teacherId: s.teacher.userId } })) === 0,
      'каскад: привязки к предметам сняты');
    const subj = await subjects.get(s.subjectId);
    check(!subj.coverageComplete, 'покрытие предмета упало до неполного — уроки без исполнителя видны человеку');
    check((await state.resolve()) === 'stale', 'сетка помечена stale — плашка, а не тихое исчезновение уроков');
    check((await b.prisma.appSession.count({ where: { userId: s.teacher.userId, revokedAt: null } })) === 0,
      'активные сессии отозваны немедленно — доступ уволенного не живёт 90 дней (AR-92)');

    await staff.reactivate(s.teacher.cardId, s.moderator);
    await drain();
    check(!(await staff.get(s.teacher.cardId)).deactivated, '«Вернуть доступ» вернул права — отзыв активации обратим');

    // ─── защита школы: последний модератор ───
    const modCard = await b.prisma.staffCard.findFirst({ where: { userId: s.moderator.userId } });
    await refuses(() => staff.remove(modCard!.id, s.moderator), 'LAST_MODERATOR',
      'удаление профиля единственного модератора отклонено — школа не остаётся без управления');
    await refuses(() => staff.revokeActivation(modCard!.id, s.moderator), 'LAST_MODERATOR',
      'отзыв активации у единственного модератора отклонён — обе операции держит одно правило');
    await refuses(() => staff.removeRole(modCard!.id, 'moderator', s.moderator), 'LAST_MODERATOR',
      'снятие роли у единственного модератора отклонено (AR-102)');

    // ─── второй модератор заводится выдачей роли (AR-102) ───
    await staff.addRole(s.teacher.cardId, 'moderator', s.moderator);
    check((await staff.get(s.teacher.cardId)).roles.includes('moderator'),
      'роль модератора выдана кнопкой «Добавить роль» — отдельной секции «Модераторы» на S-30 нет');
    // 1.2.0: у bootstrap-оператора ролей две (admin + moderator, AR-148), при
    // втором модераторе `moderator` у него снимается свободно; `LAST_ROLE`
    // проверяется ниже на сотруднике с единственной ролью (AR-102).
    await staff.removeRole(modCard!.id, 'moderator', s.moderator);
    check(!(await staff.get(modCard!.id)).roles.includes('moderator'),
      'при двух модераторах роль снимается у оператора с двумя ролями — LAST_ROLE его не держит');
    await staff.addRole(modCard!.id, 'moderator', s.moderator);
    await staff.removeRole(s.teacher.cardId, 'moderator', s.moderator);
    check(!(await staff.get(s.teacher.cardId)).roles.includes('moderator'),
      'при двух модераторах роль снимается свободно у того, у кого есть вторая — правило защищает школу, а не должность');

    // ─── последняя роль сотрудника не снимается ───
    const solo = await makeStaff(b, s, ['teacher'], 'Сидоров Олег');
    await refuses(() => staff.removeRole(solo.cardId, 'teacher', s.moderator), 'LAST_ROLE',
      'последняя роль сотрудника не снимается — для закрытия доступа есть деактивация');

    // ─── лимит носителей роли (AR-205): по умолчанию завуч один — замы ЗАВОДЯТСЯ, пока лимит свободен (AR-182) ───
    const dep = await staff.addCard({ role: 'deputy_academic', lastName: 'Волкова', firstName: 'Ирина' });
    check(dep.card.section === 2 && dep.card.roles.includes('deputy_academic'),
      'завуч (УР) заведён кнопкой секции 2 — bootstrap слотов замов не создаёт (AR-182)');
    const dup = await staff
      .addCard({ role: 'deputy_academic', lastName: 'Дублёва', firstName: 'Анна' })
      .then(() => null, (e: { response?: { code?: string; message?: string } }) => e.response);
    check(dup?.code === 'ROLE_LIMIT_REACHED' && dup?.message === 'Заместитель по учебной работе: в школе уже 1 из 1 носителей роли — лимит задаёт администратор в «Политиках»',
      `второй завуч (УР) отклонён кодом ${dup?.code}: «${dup?.message}» — лимит держит addCard, роль словами и цифрами (AR-205)`);
    await refuses(() => staff.addRole(s.teacher.cardId, 'deputy_academic', s.moderator), 'ROLE_LIMIT_REACHED',
      'выдача роли с исчерпанным лимитом через M-07 отклонена — лимит не декларация (П-4)');
    const depUp = await staff.addCard({ role: 'deputy_upbringing', lastName: 'Соловьёва', firstName: 'Вера' });
    check(depUp.card.roles.includes('deputy_upbringing'),
      'зам (ВР) — отдельный лимит: занятость завуча (УР) его не блокирует');

    // ─── лимит задаёт администратор в «Политиках»: 2 — второй проходит, третий отклонён ───
    const policy = await admin.setPolicy({ sessionLimits: {}, roleLimits: { deputy_academic: 2 } }, s.moderator);
    check(policy.roleLimits.deputy_academic === 2 && policy.roleHolders.deputy_academic === 1,
      `политика: лимит завучей ${policy.roleLimits.deputy_academic}, занято ${policy.roleHolders.deputy_academic} (AR-205)`);
    const second = await staff.addCard({ role: 'deputy_academic', lastName: 'Вторая', firstName: 'Ольга' });
    check(second.card.roles.includes('deputy_academic'), 'при лимите 2 второй завуч заводится');
    check((await admin.policy()).roleHolders.deputy_academic === 2, 'носителей стало 2 — цифра «занято» та же, что в проверке');
    const third = await staff
      .addCard({ role: 'deputy_academic', lastName: 'Третья', firstName: 'Анна' })
      .then(() => null, (e: { response?: { code?: string; details?: { count?: number; limit?: number } } }) => e.response);
    check(third?.code === 'ROLE_LIMIT_REACHED' && third?.details?.count === 2 && third?.details?.limit === 2,
      `третий завуч при лимите 2 отклонён: ${third?.details?.count} из ${third?.details?.limit}`);
    // реактивация при занятом лимите: место второго занял третий — второй не воскресает
    await staff.revokeActivation(second.card.id, s.moderator);
    await drain();
    const thirdOk = await staff.addCard({ role: 'deputy_academic', lastName: 'Третья', firstName: 'Анна' });
    check(thirdOk.card.roles.includes('deputy_academic'), 'отзыв активации освобождает место в лимите — третий заведён');
    await refuses(() => staff.reactivate(second.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'возврат доступа при занятом лимите 2 отклонён — «отозвать → завести → вернуть» носителей сверх лимита не даёт');
    // политика без ключа — дефолт 1: с одним живым завучем реактивация второго отклонена и при дефолте
    await staff.revokeActivation(thirdOk.card.id, s.moderator);
    await drain();
    const reset = await admin.setPolicy({ sessionLimits: {}, roleLimits: {} }, s.moderator);
    check(reset.roleLimits.deputy_academic === undefined && reset.roleHolders.deputy_academic === 1,
      'лимит снят с политики — действует дефолт 1 (DEFAULT_ROLE_LIMITS), занято 1');
    await refuses(() => staff.reactivate(second.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'при дефолте 1 и живом завуче возврат доступа второму отклонён');

    await staff.remove(dep.card.id, s.moderator);
    await drain();
    check((await b.prisma.staffCard.count({ where: { id: dep.card.id } })) === 0,
      'удаление профиля стирает и карточку — пустого слота-призрака, занимающего должность, не остаётся (AR-213)');
    const refill = await staff.addCard({ role: 'deputy_academic', lastName: 'Соловьёва', firstName: 'Ирина' });
    check(refill.card.roles.includes('deputy_academic'),
      'должность освободилась вместе с профилем — новый завуч заводится тут же (AR-213, AR-205)');

    // ─── обратный переход: возврат доступа тоже перепроверяет лимит (AR-205) ───
    await staff.revokeActivation(refill.card.id, s.moderator);
    await drain();
    const depB = await staff.addCard({ role: 'deputy_academic', lastName: 'Пятницкая', firstName: 'Анна' });
    check(depB.card.roles.includes('deputy_academic'),
      'отзыв активации освобождает лимит — новый завуч заводится (AR-205, AR-213)');
    await refuses(() => staff.reactivate(refill.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'возврат доступа при занятой роли отклонён — путь «отозвать → завести → вернуть» двух завучей не даёт');

    // ─── сотрудник без истории удаляется ───
    const fresh = await makeStaff(b, s, ['founder'], 'Кузнецов Пётр');
    check(!(await staff.get(fresh.cardId)).hasHistory, 'у нового сотрудника истории нет — подтверждение об отметках не говорит');
    await staff.remove(fresh.cardId, s.moderator);
    await drain();
    check((await b.prisma.membership.count({ where: { userId: fresh.userId } })) === 0,
      'сотрудник без привязок и без отметок удалён — обратной операции у этого нет по построению');

    // ─── и сотрудник С ИСТОРИЕЙ удаляется тоже (AR-213 снял STAFF_HAS_HISTORY) ───
    const marksKept = await b.prisma.mark.count();
    check((await staff.get(s.teacher.cardId)).hasHistory, 'у педагога с отметками история есть — и она больше не запрещает удаление');
    await staff.remove(s.teacher.cardId, s.moderator);
    await drain();
    check((await b.prisma.membership.count({ where: { userId: s.teacher.userId } })) === 0,
      'членство педагога с историей стёрто — человека в школе больше нет');
    check((await b.prisma.user.count({ where: { id: s.teacher.userId } })) === 0,
      'учётка стёрта физически: это было последнее членство человека (AR-213)');
    check((await b.prisma.mark.count()) === marksKept,
      'выставленные им отметки остались в журнале — запись школы, а не данные человека (AR-213)');
  });

  await b.close();
  report('G-43 · ОБРАТИМОСТЬ И КАСКАД ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
