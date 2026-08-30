/**
 * EduStore — сид демо-данных кабинета учителя (зеркалит дизайн-референс).
 * Идемпотентен: полностью пересоздаёт демо-набор при каждом запуске.
 */
import {
  GradeSource,
  LessonType,
  MaterialType,
  NotificationType,
  PrismaClient,
} from '@prisma/client';
import { syncAuthzCatalog } from '../src/common/authz/catalog';
import { syncSkus } from '../src/common/entitlements/skus';

const prisma = new PrismaClient();

/** Год учебного контекста демо-данных. */
const YEAR = 2025;

/** Детерминированный «псевдослучайный» выбор из пула по индексам. */
function pickGrade(pool: (string | null)[], a: number, b: number): string | null {
  // Простой смешивающий хэш — стабилен между запусками.
  const h = (a * 73856093) ^ (b * 19349663) ^ ((a + b) * 83492791);
  const idx = Math.abs(h) % pool.length;
  return pool[idx];
}



async function main(): Promise<void> {
  console.log('Синхронизация каталога прав (§5.1) и SKU (§5.2)…');
  await syncAuthzCatalog(prisma); // reference-data: пакеты ролей × права (идемпотентно)
  await syncSkus(prisma); // reference-data: каталог SKU

  console.log('Очистка демо-данных…');
  // Порядок важен из-за внешних ключей.
  // движок: летучка/ИОМ/журнал/контракты (каскады: BriefTest→коды/результаты, *Node→*Edge)
  await prisma.briefTest.deleteMany();
  await prisma.journalCell.deleteMany();
  await prisma.competencyNode.deleteMany();
  await prisma.interestNode.deleteMany();
  await prisma.assessmentPolicy.deleteMany();
  await prisma.timingProfile.deleteMany();
  await prisma.orgStandards.deleteMany();
  await prisma.fgosHours.deleteMany();
  await prisma.courseAssignment.deleteMany();
  await prisma.course.deleteMany();
  await prisma.methodic.deleteMany();
  // документохранилище (File каскадит DocVersion/Tag/ShareGrant; Collection → CollectionFile)
  await prisma.file.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.lens.deleteMany();
  // движок планирования (Lesson.kppLessonId → SetNull, поэтому порядок свободен)
  await prisma.kppMapping.deleteMany();
  await prisma.kppLesson.deleteMany();
  await prisma.kpp.deleteMany();
  await prisma.timetableSlot.deleteMany();
  await prisma.timetable.deleteMany();
  await prisma.ktpTopic.deleteMany();
  await prisma.ktp.deleteMany();
  await prisma.entitlement.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.journalCell.deleteMany();
  await prisma.generatedMaterial.deleteMany();
  await prisma.teacherNote.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.studentProfile.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.teachingAssignment.deleteMany();
  await prisma.student.deleteMany();
  await prisma.subGroup.deleteMany();
  await prisma.class.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.user.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.device.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.worknet.deleteMany();
  await prisma.organization.deleteMany();

  // ── платформа EduStore (одна) + школа (Workspace = единица изоляции) ──
  const platform = await prisma.organization.create({
    data: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
  });
  const ws = await prisma.workspace.create({
    data: { id: 'org-school-1', orgId: platform.id, name: 'Школа №1', sector: 'private' },
  });

  // ── entitlement демо-школы: активное ядро LMS (§5.2) — гейт материалов пускает ──
  const lmsCore = await prisma.sku.findUnique({ where: { key: 'lms.core' } });
  if (lmsCore) {
    await prisma.entitlement.create({
      data: { workspaceId: ws.id, skuId: lmsCore.id, status: 'active', source: 'manual' },
    });
  }

  // ── пользователь + учитель ──
  await prisma.user.create({
    data: {
      id: 'teacher-anna',
      firstName: 'Анна',
      lastName: 'Соколова',
      displayName: 'Анна Соколова',
      email: 'anna.sokolova@school1.ru',
    },
  });
  const teacher = await prisma.teacher.create({
    data: {
      id: 'teacher-anna',
      workspaceId: ws.id,
      isCurator: true,
    },
  });

  // ── предметы ──
  const algebra = await prisma.subject.create({
    data: { workspaceId: ws.id, name: 'Алгебра', color: '#2563EB' },
  });
  const geometry = await prisma.subject.create({
    data: { workspaceId: ws.id, name: 'Геометрия', color: '#0EA5E9' },
  });
  const math = await prisma.subject.create({
    data: { workspaceId: ws.id, name: 'Математика', color: '#16A34A' },
  });
  const informatics = await prisma.subject.create({
    data: { workspaceId: ws.id, name: 'Информатика', color: '#7C3AED' },
  });

  // ── классы + назначения (флажки) ──
  // label, parallel, letter, число учеников, предмет.
  const classSpecs: Array<{
    label: string;
    parallel: number;
    letter: string;
    count: number;
    subjectId: string;
  }> = [
    { label: '5А', parallel: 5, letter: 'А', count: 28, subjectId: math.id },
    { label: '6Б', parallel: 6, letter: 'Б', count: 26, subjectId: math.id },
    { label: '8А', parallel: 8, letter: 'А', count: 30, subjectId: algebra.id },
    { label: '9В', parallel: 9, letter: 'В', count: 24, subjectId: geometry.id },
    { label: '11А', parallel: 11, letter: 'А', count: 22, subjectId: algebra.id },
  ];

  const classByLabel: Record<string, { id: string; subjectId: string }> = {};

  for (const spec of classSpecs) {
    const klass = await prisma.class.create({
      data: {
        workspaceId: ws.id,
        parallel: spec.parallel,
        letter: spec.letter,
        label: spec.label,
      },
    });
    classByLabel[spec.label] = { id: klass.id, subjectId: spec.subjectId };

    await prisma.teachingAssignment.create({
      data: {
        workspaceId: ws.id,
        teacherId: teacher.id,
        classId: klass.id,
        subjectId: spec.subjectId,
      },
    });
  }

  // куратор ведёт 8А
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { curatorClassId: classByLabel['8А'].id },
  });

  // ── ученики 8А (точные ФИ из референса) ──
  const names8A = [
    'Авдеева Полина',
    'Беляев Кирилл',
    'Волкова Мария',
    'Громов Илья',
    'Иванов Артём',
    'Иванов Дмитрий',
    'Козлова Анна',
    'Лебедев Максим',
    'Морозова София',
    'Никитин Глеб',
    'Орлова Дарья',
    'Петров Степан',
    'Романова Ева',
    'Соколов Тимур',
    'Фёдорова Алиса',
    'Шилов Марк',
    'Антонова Вера',
    'Борисов Егор',
    'Гусева Кира',
    'Дроздов Лев',
    'Ефимова Ника',
    'Жуков Артур',
    'Зайцева Лада',
    'Киселёв Рома',
    'Лазарева Мила',
    'Макаров Денис',
    'Носова Аня',
    'Орехов Павел',
    'Панова Злата',
    'Рыбаков Иван',
  ];

  const class8A = classByLabel['8А'];
  const students8A: { id: string; number: number; displayName: string }[] = [];

  for (let i = 0; i < names8A.length; i++) {
    const display = names8A[i];
    const [lastName, firstName] = display.split(' ');
    const s = await prisma.student.create({
      data: {
        workspaceId: ws.id,
        classId: class8A.id,
        number: i + 1,
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        displayName: display,
      },
    });
    students8A.push({ id: s.id, number: s.number, displayName: display });
  }

  // ── ученики остальных классов (плейсхолдеры до нужного числа) ──
  for (const spec of classSpecs) {
    if (spec.label === '8А') continue;
    const klass = classByLabel[spec.label];
    for (let i = 0; i < spec.count; i++) {
      await prisma.student.create({
        data: {
          workspaceId: ws.id,
          classId: klass.id,
          number: i + 1,
          firstName: 'Ученик',
          lastName: `${spec.label}-${i + 1}`,
          displayName: `Ученик ${spec.label} №${i + 1}`,
        },
      });
    }
  }

  // ── уроки 8А Алгебра (10 шт., сентябрь 2025) ──
  const G2 = 'Глава 2 · Квадратные корни';
  const G3 = 'Глава 3 · Квадратные уравнения';
  const G4 = 'Глава 4 · Неравенства';

  type LessonSpec = {
    n: number;
    type: LessonType;
    topic: string;
    short: string;
    unit: string;
    day: number; // день сентября
    goals?: string[];
    pageStart?: number;
    pageEnd?: number;
  };

  const lessonSpecs: LessonSpec[] = [
    { n: 1, type: LessonType.LESSON, topic: 'Квадратные корни', short: 'Корни', unit: G2, day: 2 },
    { n: 2, type: LessonType.LESSON, topic: 'Свойства арифметического корня', short: 'Свойства корня', unit: G2, day: 4 },
    { n: 3, type: LessonType.TEST, topic: 'Самостоятельная работа №4', short: 'Сам. №4', unit: G2, day: 6 },
    { n: 4, type: LessonType.LESSON, topic: 'Преобразование выражений с корнями', short: 'Преобразования', unit: G3, day: 9 },
    {
      n: 5,
      type: LessonType.LESSON,
      topic: 'Квадратные уравнения',
      short: 'Кв. уравнения',
      unit: G3,
      day: 11,
      goals: [
        'Ввести понятие квадратного уравнения и его коэффициентов',
        'Научить распознавать полные и неполные уравнения',
        'Отработать решение неполных квадратных уравнений',
      ],
      pageStart: 64,
      pageEnd: 69,
    },
    { n: 6, type: LessonType.LESSON, topic: 'Формула корней квадратного уравнения', short: 'Формула корней', unit: G3, day: 13 },
    { n: 7, type: LessonType.LESSON, topic: 'Теорема Виета', short: 'Виет', unit: G3, day: 16 },
    { n: 8, type: LessonType.CONTROL, topic: 'Контрольная работа №3', short: 'К/р №3', unit: G3, day: 18 },
    { n: 9, type: LessonType.LESSON, topic: 'Дробные рациональные уравнения', short: 'Дробные ур.', unit: G4, day: 20 },
    { n: 10, type: LessonType.LESSON, topic: 'Решение задач с помощью уравнений', short: 'Задачи', unit: G4, day: 23 },
  ];

  const lessons8A: { id: string; n: number }[] = [];

  for (const spec of lessonSpecs) {
    const lesson = await prisma.lesson.create({
      data: {
        workspaceId: ws.id,
        subjectId: algebra.id,
        classId: class8A.id,
        topic: spec.topic,
        shortTitle: spec.short,
        unit: spec.unit,
        goals: spec.goals ?? [],
        lessonNumber: spec.n,
        date: new Date(Date.UTC(YEAR, 8, spec.day, 8, 0, 0)), // 8 = сентябрь
        type: spec.type,
        pageStart: spec.pageStart ?? null,
        pageEnd: spec.pageEnd ?? null,
        homework: spec.type === LessonType.LESSON ? `§${spec.n}, упр. ${spec.n}.1–${spec.n}.5` : null,
      },
    });
    lessons8A.push({ id: lesson.id, n: spec.n });
  }

  // ── оценки 8А: каждый ученик × каждый урок (детерминированный пул) ──
  const pool: (string | null)[] = ['5', '5', '4', '4', '4', '3', '3', '2', 'н', null, null];

  for (const student of students8A) {
    for (const lesson of lessons8A) {
      const value = pickGrade(pool, student.number, lesson.n);
      if (value === null) continue; // нет оценки
      // AR-4: единый журнал — сид пишет сразу в JournalCell ('н' = отсутствие)
      await prisma.journalCell.create({
        data: {
          workspaceId: ws.id,
          classId: class8A.id,
          disciplineId: algebra.id,
          studentId: student.id,
          lessonId: lesson.id,
          grade: value,
          postedBy: teacher.id,
          source: GradeSource.MANUAL,
        },
      });
    }
  }

  // ── материалы для урока №5 ──
  const lesson5 = lessons8A.find((l) => l.n === 5)!;
  await prisma.generatedMaterial.createMany({
    data: [
      {
        workspaceId: ws.id,
        lessonId: lesson5.id,
        type: MaterialType.LESSON_PLAN,
        title: 'План-конспект урока',
        fileUrl: '/files/stub/lesson-plan-5.docx',
        format: 'DOCX',
        meta: '6 страниц',
      },
      {
        workspaceId: ws.id,
        lessonId: lesson5.id,
        type: MaterialType.GRAPHIC_NOTES,
        title: 'Графический конспект',
        fileUrl: '/files/stub/graphic-notes-5.pdf',
        format: 'PDF',
        meta: '1 страница',
      },
      {
        workspaceId: ws.id,
        lessonId: lesson5.id,
        type: MaterialType.PRESENTATION,
        title: 'Презентация к уроку',
        fileUrl: '/files/stub/presentation-5.pptx',
        format: 'PPTX',
        meta: '18 слайдов',
      },
    ],
  });

  // ── уведомления (5 шт., зеркалят референс) ──
  // icon хранит «символ» из дизайна: alert/calendar/info/ktp/presentation.
  const now = Date.now();
  const min = 60 * 1000;
  await prisma.notification.createMany({
    data: [
      {
        workspaceId: ws.id,
        teacherId: teacher.id,
        type: NotificationType.URGENT,
        category: 'journal',
        title: 'Не выставлены оценки',
        message: 'В 8А за контрольную работу №3 не выставлены оценки.',
        icon: 'alert',
        createdAt: new Date(now - 5 * min),
      },
      {
        workspaceId: ws.id,
        teacherId: teacher.id,
        type: NotificationType.NORMAL,
        category: 'ktp',
        title: 'Приближается контрольная',
        message: 'Контрольная работа №3 в 8А через 2 дня.',
        icon: 'calendar',
        createdAt: new Date(now - 60 * min),
      },
      {
        workspaceId: ws.id,
        teacherId: teacher.id,
        type: NotificationType.INFO,
        category: 'journal',
        title: 'Отчёт сформирован',
        message: 'Еженедельный отчёт по успеваемости готов.',
        icon: 'info',
        createdAt: new Date(now - 3 * 60 * min),
      },
      {
        workspaceId: ws.id,
        teacherId: teacher.id,
        type: NotificationType.NORMAL,
        category: 'ktp',
        title: 'Обновлено КТП',
        message: 'Календарно-тематическое планирование по алгебре обновлено.',
        icon: 'ktp',
        createdAt: new Date(now - 24 * 60 * min),
      },
      {
        workspaceId: ws.id,
        teacherId: teacher.id,
        type: NotificationType.INFO,
        category: 'journal',
        title: 'Новые материалы',
        message: 'Добавлены материалы к уроку «Квадратные уравнения».',
        icon: 'presentation',
        createdAt: new Date(now - 2 * 24 * 60 * min),
      },
    ],
  });

  // ── профили нескольких учеников 8А (для персонализации заметок/тестов) ──
  await prisma.studentProfile.create({
    data: {
      workspaceId: ws.id,
      studentId: students8A[4].id, // Иванов Артём
      interests: ['футбол', 'роботы'],
      strengths: ['логика'],
      weaknesses: [],
      inclinations: ['техника'],
    },
  });
  await prisma.studentProfile.create({
    data: {
      workspaceId: ws.id,
      studentId: students8A[8].id, // Морозова София
      interests: ['рисование', 'музыка'],
      strengths: ['внимательность'],
      weaknesses: [],
      inclinations: ['искусство'],
    },
  });
  await prisma.studentProfile.create({
    data: {
      workspaceId: ws.id,
      studentId: students8A[0].id, // Авдеева Полина
      interests: ['шахматы'],
      strengths: ['усидчивость'],
      weaknesses: [],
      inclinations: ['аналитика'],
    },
  });

  // ── Движок планирования: КТП 9В·Геометрия (draft) + Timetable-геометрия ──
  // Отдельно от 8А·Алгебра (там — Phase-0 демо журнала с готовыми уроками/оценками):
  // у 9В·Геометрия НЕТ засеянных standalone-уроков → уроки появляются только из пайплайна
  // (approve КТП → Solver), без дублей. Демо §7: завуч утверждает → Solver раскладывает КПП.
  const class9V = classByLabel['9В'];
  await prisma.ktp.create({
    data: {
      workspaceId: ws.id,
      classId: class9V.id,
      disciplineId: geometry.id,
      status: 'draft',
      topics: {
        create: [
          { workspaceId: ws.id, order: 1, fgosHours: 3, arCodes: ['9.ГЕ.1.1', '9.ГЕ.1.2'], title: 'Векторы' },
          { workspaceId: ws.id, order: 2, fgosHours: 4, arCodes: ['9.ГЕ.2.1', '9.ГЕ.2.2'], title: 'Метод координат' },
          { workspaceId: ws.id, order: 3, fgosHours: 2, arCodes: ['9.ГЕ.3.1'], title: 'Соотношения в треугольнике' },
        ],
      },
    },
  });
  // Timetable: 12 слотов (3 урока × 4 дня) — хватает на 9 часов КТП
  const timetable = await prisma.timetable.create({
    data: { workspaceId: ws.id, classId: class9V.id, source: 'engine' },
  });
  const slotData: { workspaceId: string; timetableId: string; day: number; position: number; durationMin: number }[] = [];
  for (let i = 0; i < 12; i++) {
    slotData.push({ workspaceId: ws.id, timetableId: timetable.id, day: Math.floor(i / 3) + 1, position: (i % 3) + 1, durationMin: 45 });
  }
  await prisma.timetableSlot.createMany({ data: slotData });

  // ── Контракты завуча/методиста (входные слоты движка/журнала) ──
  await prisma.orgStandards.create({
    data: {
      workspaceId: ws.id,
      lessonLengthMin: 45,
      sparki: { allowed: true, subjects: [] },
      orderRules: { maxPerDay: 3 },
      fizminutki: { afterMin: 20 },
    },
  });
  // утв. ФГОС-часы 9В·Геометрия = 9 (совпадает с суммой fgosHours тем КТП → Solver доволен)
  await prisma.fgosHours.create({
    data: { workspaceId: ws.id, classId: class9V.id, disciplineId: geometry.id, hours: 9, approvedBy: 'zavuch', approvedAt: new Date() },
  });
  await prisma.assessmentPolicy.create({
    data: {
      workspaceId: ws.id,
      scope: 'школа',
      items: ['летучка', 'контрольная', 'устный ответ'],
      coefficients: { 'летучка': 1, 'контрольная': 3, 'устный ответ': 1 },
      scale: { min: 2, max: 5 },
      updatedBy: 'zavuch',
    },
  });

  // ── Кабинеты: демо-методика + курс (методист) ──
  await prisma.methodic.create({
    data: { workspaceId: ws.id, title: 'Приёмы устного счёта', body: 'Методика формирования вычислительных навыков…', disciplineId: math.id, authorId: 'methodist' },
  });
  await prisma.course.create({
    data: { workspaceId: ws.id, title: 'ФГОС: геометрия 9 класс', description: 'Курс повышения квалификации', disciplineId: geometry.id, authorId: 'methodist' },
  });

  // ── Документохранилище: демо-файлы (enriched, чтобы метаданные читались без живого S3) ──
  await prisma.file.create({
    data: {
      workspaceId: ws.id, s3Key: `docs/${ws.id}/demo-methodbank.pdf`, ownerId: 'methodist',
      scope: 'кафедра:math', audience: 'staff', mime: 'application/pdf', size: 245000,
      state: 'enriched', disciplineId: math.id, textExtract: 'Методические рекомендации по алгебре…',
      tags: { create: [{ workspaceId: ws.id, dim: 'предмет', value: 'Математика' }, { workspaceId: ws.id, dim: 'тип', value: 'методичка' }] },
    },
  });
  await prisma.file.create({
    data: {
      workspaceId: ws.id, s3Key: `docs/${ws.id}/demo-official.docx`, ownerId: 'zavuch',
      scope: 'школа', audience: 'staff', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 51200, state: 'enriched', status: 'draft', textExtract: 'Положение о промежуточной аттестации…',
    },
  });

  console.log('Готово: посеяны платформа+школа, учитель, 5 классов, уроки, оргстандарты, методики/курсы, файлы (docs/).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
