/**
 * G-13 (AR-29) — consent-гейт на выдаче производных профилирования.
 * Доказывает: (а) ученик БЕЗ predictive_profiling-согласия исключён из atRisk и явно
 * перечислен в profilingConsent.withoutConsent (не молча); (б) персональный срез ИОМ
 * без согласия → ForbiddenException NO_PROFILING_CONSENT; (в) появление согласия
 * открывает и atRisk, и срез; (г) отзыв (granted=false поверх) закрывает снова;
 * (д) сигналы (MasteryEdge) при этом существуют независимо от согласия — копятся всегда.
 * Запуск: npm run consent:check (нужен Postgres).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { AnalyticsService } from '../src/modules/engine/analytics.service';
import { IomService } from '../src/modules/engine/iom.service';

const WS = 'ws-consent-check';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const analytics = app.get(AnalyticsService);
  const iom = app.get(IomService);

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? '✓' : '✗ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  };

  // ── setup: школа, класс, ученик, узел компетенции, рисковое ребро (score низкий, conf высокий) ──
  const ids = await TenantContext.runAsSystem(async () => {
    await prisma.masteryEdge.deleteMany({ where: { workspaceId: WS } });
    await prisma.competencyNode.deleteMany({ where: { workspaceId: WS } });
    await prisma.consent.deleteMany({ where: { workspaceId: WS } });
    await prisma.student.deleteMany({ where: { workspaceId: WS } });
    await prisma.class.deleteMany({ where: { workspaceId: WS } });
    await prisma.subject.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });

    const platform = await prisma.organization.upsert({
      where: { id: 'org-edustore-platform' },
      update: {},
      create: { id: 'org-edustore-platform', name: 'EduStore', type: 'platform' },
    });
    await prisma.workspace.create({ data: { id: WS, orgId: platform.id, name: 'Consent Check' } });
    const klass = await prisma.class.create({ data: { workspaceId: WS, parallel: 7, letter: 'К', label: '7К' } });
    const subject = await prisma.subject.create({ data: { workspaceId: WS, name: 'Алгебра-КЧ', color: '#888888' } });
    const student = await prisma.student.create({
      data: { workspaceId: WS, classId: klass.id, number: 1, firstName: 'К', lastName: 'Консентов', displayName: 'Консентов К.' },
    });
    const node = await prisma.competencyNode.create({
      data: { workspaceId: WS, fgosArCode: 'AR-CHK-1', disciplineId: subject.id, label: 'Тест-компетенция' },
    });
    await prisma.masteryEdge.create({
      data: { workspaceId: WS, studentId: student.id, competencyNodeId: node.id, score: 0.2, confidence: 1, signalRefs: {} },
    });
    return { classId: klass.id, disciplineId: subject.id, studentId: student.id };
  });

  await TenantContext.run({ tenantId: WS, system: false }, async () => {
    // (а) без согласия: исключён из atRisk, явно перечислен
    const a1 = await analytics.classAnalytics(ids.classId, ids.disciplineId);
    check('без согласия: ученик НЕ в atRisk', !a1.atRisk.some((r) => r.studentId === ids.studentId));
    check(
      'без согласия: явно в profilingConsent.withoutConsent (не молча)',
      a1.profilingConsent.withoutConsent.some((s) => s.studentId === ids.studentId) && a1.profilingConsent.withConsent === 0,
    );

    // (б) персональный срез ИОМ → явный отказ
    let code = '';
    try {
      await iom.getIom(ids.studentId);
    } catch (e) {
      code = (e as { response?: { code?: string } }).response?.code ?? '';
    }
    check('срез ИОМ без согласия → NO_PROFILING_CONSENT', code === 'NO_PROFILING_CONSENT');

    // (д) сигналы при этом копятся (ребро существует независимо от согласия)
    const edges = await prisma.masteryEdge.count({ where: { studentId: ids.studentId } });
    check('сигналы копятся независимо от согласия', edges === 1);

    // (в) согласие дано → и atRisk, и срез открываются
    await prisma.consent.create({
      data: { workspaceId: WS, subjectUserId: ids.studentId, purpose: 'predictive_profiling', granted: true, grantedAt: new Date(), version: 'v1', source: 'guardian' },
    });
    const a2 = await analytics.classAnalytics(ids.classId, ids.disciplineId);
    check('с согласием: ученик в atRisk', a2.atRisk.some((r) => r.studentId === ids.studentId));
    const view = await iom.getIom(ids.studentId);
    check('с согласием: срез ИОМ доступен', view.studentId === ids.studentId);

    // (г) отзыв (append granted=false) → закрыто снова
    await prisma.consent.create({
      data: { workspaceId: WS, subjectUserId: ids.studentId, purpose: 'predictive_profiling', granted: false, grantedAt: new Date(), version: 'v1', source: 'guardian' },
    });
    const a3 = await analytics.classAnalytics(ids.classId, ids.disciplineId);
    check('после отзыва: снова исключён из atRisk', !a3.atRisk.some((r) => r.studentId === ids.studentId));
  });

  await app.close();
  console.log(`\n${fail === 0 ? '✓ CONSENT-ГЕЙТ РАБОТАЕТ' : '✗ ЕСТЬ ПРОБОИ'} — pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
