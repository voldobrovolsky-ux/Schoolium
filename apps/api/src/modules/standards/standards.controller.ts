import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { OutboxDispatcher } from '../../common/outbox/outbox.dispatcher';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { StandardsService, type AssessmentPolicyInput, type OrgStandardsInput } from './standards.service';

interface TimingBody { lessonType: string; thresholds?: unknown }
interface FgosBody { classId: string; disciplineId: string; hours: number }

// Контракты завуча/методиста — /api/v1/edu/* (Кабинеты_ТЗ §3/§4). GET свободны; PUT гейчены ролью.
@Controller('v1/edu')
export class StandardsController {
  constructor(
    private readonly standards: StandardsService,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  // ─── Завуч ───
  @Get('assessment-policy')
  getAssessmentPolicy() {
    return this.standards.getAssessmentPolicies();
  }
  @RequirePermission('standards.assessment.manage')
  @Put('assessment-policy')
  async putAssessmentPolicy(@Body() body: AssessmentPolicyInput, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.standards.putAssessmentPolicy(body, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @Get('standards/org')
  getOrg() {
    return this.standards.getOrgStandards();
  }
  @RequirePermission('standards.org.manage')
  @Put('standards/org')
  async putOrg(@Body() body: OrgStandardsInput, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.standards.putOrgStandards(body, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @Get('fgos-hours')
  getFgos() {
    return this.standards.getFgosHours();
  }
  @RequirePermission('standards.fgos.approve')
  @Put('fgos-hours/approve')
  async approveFgos(@Body() body: FgosBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.standards.approveFgosHours(body, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  // ─── Методист ───
  @Get('standards/timing-profiles')
  getTiming() {
    return this.standards.getTimingProfiles();
  }
  @RequirePermission('standards.timing.manage')
  @Put('standards/timing-profiles')
  async putTiming(@Body() body: TimingBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.standards.putTimingProfile(body.lessonType, body.thresholds as never, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }
}
