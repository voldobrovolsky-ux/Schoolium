import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { STANDARDS_EVENTS } from './standards.contract';

export interface AssessmentPolicyInput {
  scope: string; // школа | класс | дисциплина
  classId?: string;
  disciplineId?: string;
  items?: Prisma.InputJsonValue;
  coefficients?: Prisma.InputJsonValue;
  scale?: Prisma.InputJsonValue;
}
export interface OrgStandardsInput {
  lessonLengthMin?: number;
  sparki?: Prisma.InputJsonValue;
  orderRules?: Prisma.InputJsonValue;
  fizminutki?: Prisma.InputJsonValue;
}

/**
 * Контракты завуча/методиста (Техспека §3) — производитель. Завуч: AssessmentPolicy/OrgStandards/
 * FgosHours; методист: TimingProfile. Движок/журнал — потребители (читают таблицы/событие).
 */
@Injectable()
export class StandardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── AssessmentPolicy (завуч → журнал, ИОМ) ───
  getAssessmentPolicies() {
    return this.prisma.assessmentPolicy.findMany({ orderBy: { updatedAt: 'desc' } });
  }
  async putAssessmentPolicy(input: AssessmentPolicyInput, actor: string) {
    const ws = TenantContext.require();
    const where = { scope: input.scope, classId: input.classId ?? null, disciplineId: input.disciplineId ?? null };
    const existing = await this.prisma.assessmentPolicy.findFirst({ where });
    const data = { ...where, items: input.items, coefficients: input.coefficients, scale: input.scale, updatedBy: actor };
    const policy = existing
      ? await this.prisma.assessmentPolicy.update({ where: { id: existing.id }, data })
      : await this.prisma.assessmentPolicy.create({ data: { workspaceId: ws, ...data } });
    await this.emit(STANDARDS_EVENTS.assessmentPolicyUpdated, { policyId: policy.id, scope: policy.scope }, actor);
    return policy;
  }

  // ─── TimingProfile (методист → Lesson FSM) ───
  getTimingProfiles() {
    return this.prisma.timingProfile.findMany();
  }
  async putTimingProfile(lessonType: string, thresholds: Prisma.InputJsonValue, actor: string) {
    const ws = TenantContext.require();
    const tp = await this.prisma.timingProfile.upsert({
      where: { workspaceId_lessonType: { workspaceId: ws, lessonType } },
      update: { thresholds, updatedBy: actor },
      create: { workspaceId: ws, lessonType, thresholds, updatedBy: actor },
    });
    await this.emit(STANDARDS_EVENTS.timingProfileUpdated, { lessonType }, actor);
    return tp;
  }

  // ─── OrgStandards (завуч → Solver) — синглтон на школу ───
  getOrgStandards() {
    return this.prisma.orgStandards.findFirst();
  }
  async putOrgStandards(input: OrgStandardsInput, actor: string) {
    const ws = TenantContext.require();
    const os = await this.prisma.orgStandards.upsert({
      where: { workspaceId: ws },
      update: { ...input, updatedBy: actor },
      create: { workspaceId: ws, lessonLengthMin: input.lessonLengthMin ?? 45, sparki: input.sparki, orderRules: input.orderRules, fizminutki: input.fizminutki, updatedBy: actor },
    });
    await this.emit(STANDARDS_EVENTS.standardsUpdated, { category: 'оргстандарты' }, actor);
    return os;
  }

  // ─── FgosHours (завуч утв. → Solver) ───
  getFgosHours() {
    return this.prisma.fgosHours.findMany();
  }
  async approveFgosHours(input: { classId: string; disciplineId: string; hours: number }, actor: string) {
    const ws = TenantContext.require();
    const fh = await this.prisma.fgosHours.upsert({
      where: { workspaceId_classId_disciplineId: { workspaceId: ws, classId: input.classId, disciplineId: input.disciplineId } },
      update: { hours: input.hours, approvedBy: actor, approvedAt: new Date() },
      create: { workspaceId: ws, classId: input.classId, disciplineId: input.disciplineId, hours: input.hours, approvedBy: actor, approvedAt: new Date() },
    });
    await this.emit(STANDARDS_EVENTS.fgosHoursApproved, { classId: input.classId, disciplineId: input.disciplineId, hours: input.hours }, actor);
    return fh;
  }

  private async emit(type: string, payload: object, actor: string) {
    const ws = TenantContext.require();
    await this.prisma.$transaction((tx) => this.outbox.enqueue(tx, newEvent({ type, workspaceId: ws, actor, payload })));
  }
}
