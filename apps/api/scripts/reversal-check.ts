/**
 * G-43 (AR-89, AR-90, AR-78, AR-102, AR-182, AR-205) — **обратимость операций и
 * каскад удаления.**
 *
 *   · у КАЖДОЙ операции реестра есть обратная либо записанная причина её
 *     отсутствия; необратимых пять, и каждая необратима по построению;
 *   · сотрудник без истории удаляется, с историей — деактивируется, и
 *     деактивация обратима реактивацией;
 *   · каскад: привязки сняты, покрытие упало, сетка `stale`, выставленные им
 *     отметки ОСТАЛИСЬ — `postedBy` историческая ссылка, а не живая связь;
 *   · последний активный модератор не удаляется и не деактивируется
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
  for (const need of ['удалить класс', 'удалить предмет', 'удалить ученика', 'удалить сотрудника', 'снять роль', 'открепить педагога']) {
    check(reg.some((r) => r.op === need), `разрушающая операция «${need}» стоит в реестре СВОЕЙ строкой (AR-105)`);
  }

  // ─── каскад удаления и деактивации сотрудника ───
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
    check(card.hasHistory, 'сервер вернул hasHistory: true — экран покажет «Деактивировать», а не «Удалить» (AR-89)');

    await refuses(() => staff.remove(s.teacher.cardId, s.moderator), 'STAFF_HAS_HISTORY',
      'удаление сотрудника с историей отклонено гейтом контракта именованным кодом (AR-113)');

    await staff.deactivate(s.teacher.cardId, s.moderator);
    await drain();
    const after = await staff.get(s.teacher.cardId);
    check(after.deactivated, 'сотрудник деактивирован: доступ закрыт, карточка осталась');
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
    check(!(await staff.get(s.teacher.cardId)).deactivated, 'реактивация вернула доступ — деактивация обратима');

    // ─── защита школы: последний модератор ───
    const modCard = await b.prisma.staffCard.findFirst({ where: { userId: s.moderator.userId } });
    await refuses(() => staff.remove(modCard!.id, s.moderator), 'LAST_MODERATOR',
      'удаление единственного модератора отклонено — школа не остаётся без управления');
    await refuses(() => staff.deactivate(modCard!.id, s.moderator), 'LAST_MODERATOR',
      'деактивация единственного модератора отклонена');
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
    await staff.deactivate(second.card.id, s.moderator);
    await drain();
    const thirdOk = await staff.addCard({ role: 'deputy_academic', lastName: 'Третья', firstName: 'Анна' });
    check(thirdOk.card.roles.includes('deputy_academic'), 'деактивация освобождает место в лимите — третий заведён');
    await refuses(() => staff.reactivate(second.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'реактивация при занятом лимите 2 отклонена — «деактивировать → завести → реактивировать» носителей сверх лимита не даёт');
    // политика без ключа — дефолт 1: с одним живым завучем реактивация второго отклонена и при дефолте
    await staff.deactivate(thirdOk.card.id, s.moderator);
    await drain();
    const reset = await admin.setPolicy({ sessionLimits: {}, roleLimits: {} }, s.moderator);
    check(reset.roleLimits.deputy_academic === undefined && reset.roleHolders.deputy_academic === 1,
      'лимит снят с политики — действует дефолт 1 (DEFAULT_ROLE_LIMITS), занято 1');
    await refuses(() => staff.reactivate(second.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'при дефолте 1 и живом завуче реактивация второго отклонена');

    await staff.remove(dep.card.id, s.moderator);
    await drain();
    await refuses(() => staff.addCard({ role: 'deputy_academic', lastName: 'Повторова', firstName: 'Дарья' }), 'ROLE_LIMIT_REACHED',
      'после удаления носителя карточка остаётся ПУСТЫМ СЛОТОМ — роль занята слотом, вторая карточка не заводится');
    const refill = await staff.fillCard(dep.card.id, { lastName: 'Соловьёва', firstName: 'Ирина' });
    check(refill.card.roles.includes('deputy_academic'),
      'пустой слот зама заполняется заново через карточку (fillCard) — канал AR-60 живёт, лимит слот не проверяет');

    // ─── обратный переход: реактивация тоже перепроверяет лимит (AR-205) ───
    await staff.deactivate(dep.card.id, s.moderator);
    await drain();
    const depB = await staff.addCard({ role: 'deputy_academic', lastName: 'Пятницкая', firstName: 'Анна' });
    check(depB.card.roles.includes('deputy_academic'),
      'деактивация освобождает лимит — новый завуч заводится (AR-89, AR-205)');
    await refuses(() => staff.reactivate(dep.card.id, s.moderator), 'ROLE_LIMIT_REACHED',
      'реактивация при занятой роли отклонена — путь «деактивировать → завести → реактивировать» двух завучей не даёт');

    // ─── сотрудник без истории удаляется ───
    const fresh = await makeStaff(b, s, ['founder'], 'Кузнецов Пётр');
    check(!(await staff.get(fresh.cardId)).hasHistory, 'у нового сотрудника истории нет — экран покажет «Удалить»');
    await staff.remove(fresh.cardId, s.moderator);
    await drain();
    check((await b.prisma.membership.count({ where: { userId: fresh.userId } })) === 0,
      'сотрудник без привязок и без отметок удалён — обратной операции у этого нет по построению');
  });

  await b.close();
  report('G-43 · ОБРАТИМОСТЬ И КАСКАД ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
