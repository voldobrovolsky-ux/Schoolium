/**
 * e2e сквозного потока «учебник → КТП → КПП → содержание уроков» (без браузера):
 *  1) загрузка через МЕТОДКОПИЛКУ с авто-контекстом из TeachingAssignment (класс+дисциплина
 *     не выбираются руками): одно назначение — авто; несколько — только своё (assignmentId);
 *  2) живой docs/-контур на STORAGE_MODE=local: upload-init → PUT (провайдер) → commit →
 *     enrich (экстракция text/plain) → textbook.parsed → генератор КТП;
 *  3) черновик КТП: темы по title без дублей, fgosHours = max(1, ceil(карт/5)),
 *     hoursSource='estimated'; ручная правка снимает флаг; повтор события — идемпотентен;
 *  4) approved КТП не трогается — новая загрузка создаёт НОВУЮ draft-версию;
 *  5) ktp.approved → Solver → КПП; kpp.approved → карты равномерно по урокам темы
 *     (⌊C/L⌋ + остаток в первые, порядок парсера), повторный approve не дублирует;
 *  6) llm-провайдер без связи → fallback на regexp (загрузка не падает);
 *  7) настройки парсера: apiKey шифруется, GET отдаёт только маску.
 * Запуск: npm run flow:check  (нужен поднятый Postgres).
 */
process.env.STORAGE_MODE = 'local';
process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? '/tmp/edustore-flow-check-storage';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxDispatcher } from '../src/common/outbox/outbox.dispatcher';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { LocalFsProvider } from '../src/common/storage/local-fs.provider';
import { STORAGE_PROVIDER } from '../src/common/storage/storage.types';
import { MaterialService } from '../src/modules/textbook/material.service';
import { ParserSettingsService } from '../src/modules/textbook/parser-settings.service';
import { EngineService } from '../src/modules/engine/engine.service';

const WS = 'flow-test-ws';
const TEACHER = 'flow-teacher-1';
const TEACHER2 = 'flow-teacher-2';

// 2 темы: 7 карт (→ ceil(7/5)=2 ч) и 3 карты (→ 1 ч)
const TEXTBOOK = [
  'Глава 1. Векторы',
  ...Array.from({ length: 7 }, (_, i) => [`§ ${i + 1}. Параграф ${i + 1}`, `Текст параграфа ${i + 1}.`]).flat(),
  'Глава 2. Метод координат',
  ...Array.from({ length: 3 }, (_, i) => [`§ ${i + 8}. Параграф ${i + 8}`, `Текст параграфа ${i + 8}.`]).flat(),
].join('\n');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const dispatcher = app.get(OutboxDispatcher);
  const material = app.get(MaterialService);
  const settings = app.get(ParserSettingsService);
  const engine = app.get(EngineService);
  const storage = app.get<LocalFsProvider>(STORAGE_PROVIDER);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}${ok || !extra ? '' : ` — ${extra}`}`);
    ok ? pass++ : fail++;
  };
  const inWs = <T>(fn: () => Promise<T>) => TenantContext.run({ tenantId: WS, system: false }, fn);

  // ── подготовка: школа, класс+дисциплина, учитель с ОДНИМ назначением, Timetable ──
  await TenantContext.runAsSystem(async () => {
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: [TEACHER, TEACHER2] } } });
    await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    await prisma.workspace.create({ data: { id: WS, orgId: 'org-edustore-platform', name: 'Flow Test School' } });
  });
  const { classId, class2Id, subjectId } = await inWs(async () => {
    const cls = await prisma.class.create({ data: { workspaceId: WS, parallel: 6, letter: 'А', label: '6А' } });
    const cls2 = await prisma.class.create({ data: { workspaceId: WS, parallel: 7, letter: 'Б', label: '7Б' } });
    const subj = await prisma.subject.create({ data: { workspaceId: WS, name: 'Математика' } });
    for (const t of [TEACHER, TEACHER2]) {
      await TenantContext.runAsSystem(() => prisma.user.create({ data: { id: t, firstName: 'Т', lastName: t, displayName: `Учитель ${t}` } }));
      await prisma.teacher.create({ data: { id: t, workspaceId: WS } });
    }
    await prisma.teachingAssignment.create({ data: { workspaceId: WS, teacherId: TEACHER, classId: cls.id, subjectId: subj.id } });
    // у второго учителя ДВА назначения (для селектора/ошибок)
    await prisma.teachingAssignment.create({ data: { workspaceId: WS, teacherId: TEACHER2, classId: cls.id, subjectId: subj.id } });
    await prisma.teachingAssignment.create({ data: { workspaceId: WS, teacherId: TEACHER2, classId: cls2.id, subjectId: subj.id } });
    await prisma.timetable.create({
      data: {
        workspaceId: WS,
        classId: cls.id,
        slots: { create: Array.from({ length: 20 }, (_, i) => ({ workspaceId: WS, day: Math.floor(i / 4) + 1, position: (i % 4) + 1, durationMin: 45 })) },
      },
    });
    return { classId: cls.id, class2Id: cls2.id, subjectId: subj.id };
  });

  /** Живая загрузка «учебника» через методкопилку (текстовый файл — экстракция в enrich). */
  const uploadTextbook = async (teacherId: string, text: string, assignmentId?: string) =>
    inWs(async () => {
      const init = await material.uploadInit({ mime: 'text/plain', assignmentId }, teacherId);
      const file = await prisma.file.findUnique({ where: { id: init.fileId } });
      await storage.writeObject(file!.s3Key, Buffer.from(text, 'utf8'), 'text/plain'); // = PUT по presigned URL
      const res = await material.commit(init.fileId, teacherId);
      return { ...res, fileId: init.fileId };
    });

  // ── 1) авто-контекст: одно назначение → без вопросов; classId у File и Material ──
  const up1 = await uploadTextbook(TEACHER, TEXTBOOK);
  await dispatcher.drain();
  check('одно назначение: загрузка без выбора класса/дисциплины', up1.classId === classId && up1.disciplineId === subjectId);
  const mat1 = await inWs(() => prisma.material.findUnique({ where: { id: up1.materialId } }));
  check('Material.classId проставлен из назначения', mat1?.classId === classId);

  // несколько назначений: без assignmentId → ASSIGNMENT_REQUIRED; чужое → NOT_YOUR_ASSIGNMENT
  const err1 = await inWs(() => material.uploadInit({ mime: 'text/plain' }, TEACHER2).then(() => null, (e) => e));
  check('несколько назначений без выбора → ASSIGNMENT_REQUIRED', err1?.response?.code === 'ASSIGNMENT_REQUIRED');
  const anna = await inWs(() => prisma.teachingAssignment.findFirst({ where: { teacherId: TEACHER } }));
  const err2 = await inWs(() => material.uploadInit({ mime: 'text/plain', assignmentId: anna!.id }, TEACHER2).then(() => null, (e) => e));
  check('чужое назначение → NOT_YOUR_ASSIGNMENT', err2?.response?.code === 'NOT_YOUR_ASSIGNMENT');

  // ── 2) enrich извлёк текст; парсер разобрал ──
  const file1 = await inWs(() => prisma.file.findUnique({ where: { id: up1.fileId } }));
  check('enrich: textExtract извлечён из объекта хранилища', !!file1?.textExtract && file1.textExtract.includes('Глава 1'));
  const cards1 = await inWs(() => prisma.textbookCard.count({ where: { materialId: up1.materialId } }));
  check('парсер: 10 карт разобрано', cards1 === 10);

  // ── 3) черновик КТП сгенерирован по textbook.parsed ──
  const draft = await inWs(() =>
    prisma.ktp.findFirst({ where: { classId, disciplineId: subjectId, status: 'draft' }, include: { topics: { orderBy: { order: 'asc' } } } }),
  );
  check('КТП-черновик создан (ktp.generated)', !!draft && draft.topics.length === 2);
  check('fgosHours = ceil(7/5)=2 и ceil(3/5)=1', draft?.topics[0]?.fgosHours === 2 && draft?.topics[1]?.fgosHours === 1);
  check('темы помечены hoursSource=estimated', draft?.topics.every((t) => t.hoursSource === 'estimated') ?? false);
  const ktpGen = await TenantContext.runAsSystem(() => prisma.outboxEvent.count({ where: { workspaceId: WS, type: 'planning.ktp.generated.v1' } }));
  check('событие ktp.generated эмитировано', ktpGen >= 1);

  // идемпотентность: переигровка textbook.parsed не плодит дубли
  const evt = await TenantContext.runAsSystem(() =>
    prisma.outboxEvent.findFirst({ where: { workspaceId: WS, type: 'textbook.material.parsed.v1' }, orderBy: { createdAt: 'asc' } }),
  );
  await TenantContext.runAsSystem(() => prisma.outboxEvent.update({ where: { id: evt!.id }, data: { status: 'PENDING' } }));
  await dispatcher.drain();
  const draftAfter = await inWs(() => prisma.ktpTopic.count({ where: { ktpId: draft!.id } }));
  check('повтор textbook.parsed: тем не прибавилось', draftAfter === 2);

  // ── 4) ручная правка темы снимает флаг «оценка» ──
  const t2 = draft!.topics[1];
  await inWs(() => engine.updateKtpTopic(t2.id, { fgosHours: 2 }, 'zavuch-1'));
  const t2After = await inWs(() => prisma.ktpTopic.findUnique({ where: { id: t2.id } }));
  check('правка завуча: fgosHours=2, hoursSource снят', t2After?.fgosHours === 2 && t2After?.hoursSource === null);
  await inWs(() => engine.updateKtpTopic(t2.id, { fgosHours: 1 }, 'zavuch-1')); // вернуть для раскладки 2+1

  // ── 5) утверждение: ktp.approved → Solver → КПП; kpp.approved → содержание уроков ──
  await inWs(() => engine.approveKtp(draft!.id, 'zavuch-1'));
  await dispatcher.drain();
  const kpp = await inWs(() =>
    prisma.kpp.findFirst({ where: { classId, disciplineId: subjectId }, include: { lessons: { orderBy: { sequenceNo: 'asc' } } } }),
  );
  check('Solver собрал КПП: 3 урока (2+1)', kpp?.lessons.length === 3);

  await inWs(() => engine.approveKpp(kpp!.id, 'zavuch-1'));
  await dispatcher.drain();
  const contents = await inWs(() =>
    prisma.lessonContent.findMany({
      where: { kppLessonId: { in: kpp!.lessons.map((l) => l.id) } },
      include: { card: true },
      orderBy: [{ kppLessonId: 'asc' }, { order: 'asc' }],
    }),
  );
  const perLesson = kpp!.lessons.map((l) => contents.filter((c) => c.kppLessonId === l.id));
  check('карты разложены: 4+3 в теме 1 (⌊7/2⌋+остаток), 3 в теме 2', perLesson.map((x) => x.length).join(',') === '4,3,3');
  const orderOk =
    perLesson[0].map((c) => c.card.title.split('.')[0]).join(',') === '§ 1,§ 2,§ 3,§ 4' &&
    perLesson[1].map((c) => c.card.title.split('.')[0]).join(',') === '§ 5,§ 6,§ 7';
  check('порядок карт сохранён от парсера', orderOk);

  // идемпотентность: повторный kpp.approved не дублирует связи
  await inWs(() => engine.approveKpp(kpp!.id, 'zavuch-1'));
  await dispatcher.drain();
  const contentsAfter = await inWs(() => prisma.lessonContent.count({ where: { kppLessonId: { in: kpp!.lessons.map((l) => l.id) } } }));
  check('повторный kpp.approved: связей не прибавилось', contentsAfter === contents.length);

  // ── 6) approved КТП не трогаем: новая загрузка → НОВЫЙ черновик ──
  const up2 = await uploadTextbook(TEACHER, TEXTBOOK);
  await dispatcher.drain();
  const ktps = await inWs(() => prisma.ktp.findMany({ where: { classId, disciplineId: subjectId }, include: { topics: true }, orderBy: { createdAt: 'asc' } }));
  const approved = ktps.find((k) => k.id === draft!.id);
  const newDraft = ktps.find((k) => k.id !== draft!.id);
  check('approved КТП остался approved и с 2 темами', approved?.status === 'approved' && approved.topics.length === 2);
  check('создана новая draft-версия с темами из парсера', newDraft?.status === 'draft' && newDraft.topics.length === 2);
  check('новый черновик снова с оценкой парсера', newDraft?.topics.every((t) => t.hoursSource === 'estimated') ?? false);
  void up2;

  // дозагрузка в существующий черновик: темы по title не дублируются, карты прикрепляются
  const up3 = await uploadTextbook(TEACHER, TEXTBOOK);
  await dispatcher.drain();
  const draft2 = await inWs(() => prisma.ktp.findFirst({ where: { id: newDraft!.id }, include: { topics: true } }));
  check('дозагрузка того же учебника: дублей тем нет', draft2?.topics.length === 2);
  const attached = await inWs(() => prisma.textbookCard.count({ where: { materialId: up3.materialId, ktpTopicId: { not: null } } }));
  check('карты новой загрузки прикреплены к темам черновика', attached === 10);

  // ── 7) llm-провайдер: нет связи → fallback на regexp, загрузка не падает ──
  await inWs(() => settings.put({ provider: 'llm', endpointUrl: 'http://127.0.0.1:9', apiKey: 'sk-test-fallback', modelName: 'test' }, 'admin'));
  const up4 = await uploadTextbook(TEACHER, TEXTBOOK.replace('Глава 2', 'Глава 3'));
  await dispatcher.drain();
  const cards4 = await inWs(() => prisma.textbookCard.count({ where: { materialId: up4.materialId } }));
  check('llm упал → fallback regexp разобрал карты', cards4 === 10);

  // ── 8) настройки: ключ шифруется, GET — только маска ──
  const row = await inWs(() => prisma.workspaceSettings.findUnique({ where: { workspaceId: WS } }));
  check('apiKey в БД зашифрован (не plaintext)', !!row?.parserApiKeyEnc && !row.parserApiKeyEnc.includes('sk-test-fallback'));
  const view = await inWs(() => settings.getView());
  check('GET отдаёт маску sk-***, не ключ', view.apiKeyMask === 'sk-***');
  const full = await settings.getForWorkspace(WS);
  check('внутренняя расшифровка ключа работает', full.apiKey === 'sk-test-fallback');

  // ── уборка ──
  await TenantContext.runAsSystem(async () => {
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: WS } });
    await prisma.user.deleteMany({ where: { id: { in: [TEACHER, TEACHER2] } } });
  });
  await app.close();
  console.log(`\n${fail === 0 ? '✓ СКВОЗНОЙ ПОТОК OK' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
