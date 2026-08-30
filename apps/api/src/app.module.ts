import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { AuthModule } from './common/auth/auth.module';
import { AuthGuard } from './common/auth/auth.guard';
import { PermissionGuard } from './common/authz/permission.guard';
import { TenantInterceptor } from './common/tenant/tenant.interceptor';
import { AuthzModule } from './common/authz/authz.module';
import { AuditModule } from './common/audit/audit.module';
import { EntitlementsModule } from './common/entitlements/entitlements.module';
import { EntitlementInterceptor } from './common/entitlements/entitlement.interceptor';
import { EventsModule } from './common/events/events.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { PlanningModule } from './modules/planning/planning.module';
import { JournalModule } from './modules/journal/journal.module';
import { VoiceModule } from './modules/voice/voice.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { NotesModule } from './modules/notes/notes.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StructureModule } from './modules/structure/structure.module';
import { DeviceModule } from './modules/oidc-device/device.module';
import { ConsentModule } from './modules/consent/consent.module';
import { EngineModule } from './modules/engine/engine.module';
import { StandardsModule } from './modules/standards/standards.module';
import { CabinetsModule } from './modules/cabinets/cabinets.module';
import { DocModule } from './modules/doc/doc.module';
import { TextbookModule } from './modules/textbook/textbook.module';
import { CommModule } from './modules/comm/comm.module';
import { PilotModule } from './modules/pilot/pilot.module';
// Schoolium 1.1.1: онбординг школы, контур доступа без SMS, производный журнал.
import { SchooliumModule } from './schoolium/schoolium.module';
import { ObservabilityModule } from './schoolium/observability/observability.module';
// Параметры (система параметров EduStore, см. docs/PARAMETERS.md). Новый параметр = одна строка.
import { ContingentModule } from './parameters/contingent/contingent.module';
import { CommsModule } from './parameters/comms/comms.module';
import { NutritionModule } from './parameters/nutrition/nutrition.module';
import { UmkParamModule } from './parameters/umk-param/umk-param.module';
import { ComplianceModule } from './parameters/compliance/compliance.module';

/**
 * Сборка модульного монолита: глобальный доступ к БД + событийный kernel +
 * доменные модули (кабинет) + параметры. Новый домен/параметр = одна строка здесь.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // §4.6: планировщик для фонового диспетчера outbox
    PrismaModule,
    StorageModule, // объектное хранилище (S3-абстракция, ленивый клиент)
    AuthModule, // Флёрус OIDC RP (ADR-0005)
    AuthzModule, // §5.1: права как данные (каталог + резолвер доступа)
    EntitlementsModule, // §5.2: SKU/entitlement + гейт загрузки модуля
    EventsModule, // event bus + transactional outbox + idempotent inbox + durability-воркер (shared kernel)
    AuditModule, // §4.8: append-only audit-леджер (пишется из ПДн-событий)
    // кабинет учителя (поверхность параметра УМК)
    TeacherModule,
    PlanningModule,
    JournalModule,
    VoiceModule,
    MaterialsModule,
    NotesModule,
    ReportsModule,
    StructureModule, // ручное создание структуры школы (онбординг 4.2/6)
    DeviceModule, // привязка устройств + вход на киоске (главная, режимы 2/3)
    ConsentModule, // §6: согласие на обработку ПДн (152-ФЗ)
    EngineModule, // Phase 1: движок планирования (КТП/КПП Solver + Lesson FSM)
    StandardsModule, // Phase 1: контракты завуча/методиста (AssessmentPolicy/TimingProfile/OrgStandards/FgosHours)
    CabinetsModule, // Phase 1: кабинеты (методики/курсы/курирование + надзор завуча)
    DocModule, // Phase 1: документохранилище (файлы/версии/теги/статус) на S3-абстракции
    TextbookModule, // Phase 1: учебники + парсер (doc.file.enriched → textbook.parsed → КТП)
    CommModule, // Phase 1: Communitoria — граф контактов + инварианты безопасности миноров
    PilotModule, // ВРЕМЕННЫЙ: пилотный auth (AUTH_MODE=pilot-qr) — owner-QR-онбординг для запуска
    SchooliumModule, // 1.1.1: пустая школа превращается в работающую (AR-72…AR-109)
    ObservabilityModule, // AR-97: env-флаги отладки, /healthz, requestId; маскирование ПДн не отключается
    // параметры
    ContingentModule,
    CommsModule,
    NutritionModule,
    UmkParamModule,
    ComplianceModule, // §6.4: реакция на запрос удаления ПДн
  ],
  providers: [
    // Единый guard: сессия Флёруса или DEV-bypass (AUTH_MODE != production).
    { provide: APP_GUARD, useClass: AuthGuard },
    // §5.1: гейтинг роутов по каталогу прав — ПОСЛЕ AuthGuard (req.user установлен).
    { provide: APP_GUARD, useClass: PermissionGuard },
    // §3.6: tenant-контекст запроса в ALS (после guard, до обработчика) → изоляция тенанта.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    // §5.2: гейт entitlement — ПОСЛЕ TenantInterceptor (выполняется внутри tenant-контекста).
    { provide: APP_INTERCEPTOR, useClass: EntitlementInterceptor },
  ],
})
export class AppModule {}
