import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { EventsModule } from '../common/events/events.module';
import { AuthzModule } from '../common/authz/authz.module';
import { AuditModule } from '../common/audit/audit.module';
import { SchoolStateService } from './school-state.service';
import { AccessService } from './access/access.service';
import { AccountsService } from './access/accounts.service';
import { DiaryService } from './diary/diary.service';
import { MeController, SchoolAuthController } from './access/access.controller';
import { ContingentContractService, ContingentService } from './contingent/contingent.service';
import { SubjectsContractService, SubjectsService } from './subjects/subjects.service';
import { StaffService } from './staff/staff.service';
import { CalendarContractService, CalendarService } from './calendar/calendar.service';
import { ScheduleService } from './schedule/schedule.service';
import { JournalContractService, JournalService } from './journal/journal.service';
import { JournalProjection } from './journal/journal.projection';
import {
  CalendarController,
  ClassesController,
  DiaryController,
  GuardiansController,
  PendingController,
  SchoolJournalController,
  ScheduleController,
  SchoolAdminController,
  StaffController,
  StudentsController,
  SubjectsController,
} from './schoolium.controllers';

/**
 * Schoolium 1.1.1 — онбординг школы и производный журнал.
 *
 * Модуль собран как семь контуров с названными границами: доступ, контингент,
 * предметы, персонал, календарь, расписание, журнал. Данные пересекают границу
 * ТОЛЬКО контрактом (красная линия 5): читающие контракты (`*ContractService`)
 * и события через outbox/inbox. Прямого запроса в чужую схему нет ни одного —
 * это доказывают ворота G-23 и G-50.
 *
 * Legacy-контур КТП/КПП живёт в той же базе, но не в том же сценарии (AR-83,
 * AR-84, AR-104): ни одна модель здесь не переиспользует его таблиц.
 */
@Module({
  imports: [PrismaModule, EventsModule, AuthzModule, AuditModule],
  controllers: [
    SchoolAuthController,
    MeController,
    ClassesController,
    StudentsController,
    SubjectsController,
    StaffController,
    GuardiansController,
    DiaryController,
    PendingController,
    CalendarController,
    ScheduleController,
    SchoolJournalController,
    SchoolAdminController,
  ],
  providers: [
    SchoolStateService,
    AccessService,
    AccountsService,
    DiaryService,
    ContingentService,
    ContingentContractService,
    SubjectsService,
    SubjectsContractService,
    StaffService,
    CalendarService,
    CalendarContractService,
    ScheduleService,
    JournalService,
    JournalContractService,
    JournalProjection,
  ],
  exports: [
    SchoolStateService,
    AccessService,
    AccountsService,
    DiaryService,
    ContingentContractService,
    SubjectsContractService,
    CalendarContractService,
    JournalContractService,
    ScheduleService,
    StaffService,
  ],
})
export class SchooliumModule {}
