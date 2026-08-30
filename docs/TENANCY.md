# Изоляция тенанта (§3.6) — модель и реализация

> **Пересмотр 2026-08-19** (продуктовая логика, AR-44): иерархия зафиксирована как
> `workspace` → `worknet` → `federation`. Единица изоляции по-прежнему одна —
> **workspace = школа**; `worknet` — биллинг-сущность и атрибут школы, а не второй
> ключ; `federation` — слот, не проектируется. Членство школы в сети авторится
> внутри Schoolium (внешнего синка больше нет — AR-46, AR-49), tenancy-роли и
> панель владельца — экраны Schoolium (AR-53). Разделы ниже описывают механику,
> которая от этого не изменилась; упоминания внешнего IdP читаются как легаси
> (AR-58). Ворота — G-22.

## Модель (канон Флёра, §3.5 РЕШЁН)
**Единица изоляции = ШКОЛА = `Workspace`.** Ключ тенанта — `workspaceId` на каждой
доменной таблице. Источник ключа — claim `workspace_id` логин-токена (scope `flor:workspace`,
доступен сейчас).

Иерархия (зеркало канона Флёра):
- **`Organization`** = САМА ПЛАТФОРМА EduStore (одна, `flor_owned`, `org_type=platform`).
  Арендатор у Флёра. Доменные данные на неё НЕ ключуются.
- **`Workspace`** = школа/филиал. Единица изоляции. `florusWorkspaceId` ← `workspace_id`.
- **`Worknet`** = сеть школ. `Workspace.worknetId` — nullable FK (школа максимум в одной сети,
  контейнер, не many-to-many). Сущность и колонка заведены; **синк членства в сеть — стаб**
  до Phase 1 Флёра (`florus_worknets[]`).

Две оси ролей (канон §4.1): **DOMAIN** (teacher/student/parent/staff — в `Membership`,
приходят в токен, это наше) vs **TENANCY** (operator/org_admin/workspace_admin — RoleAssignment
Флёра, в токен НЕ приходят). Каталог прав (§5.1) строится только на доменных ролях; admin/owner
кабинеты ведёт панель Флёра/walk-up, не RP-каталог.

## Механика (`apps/api/src/common/tenant/`)
- `tenant-context.ts` — `AsyncLocalStorage`: тенант запроса (`tenantId` = workspaceId / `system`).
- `tenant.interceptor.ts` — глобальный: контекст из сессии (`req.user.workspaceId`); в DEV/без
  активной школы выводит из directory (Membership/Teacher.workspaceId); публичные маршруты → система.
- `tenant-guard.ts` — Prisma `$use` middleware: подмешивает `{ workspaceId }` в `where`
  (read/update/delete) и в `data` (create). Чужая строка → пусто / `P2025`. system/не-HTTP → обход,
  аутентифицирован-без-тенанта → fail-closed.
- `tenant-models.ts` — карта `модель → workspaceId` (единый источник; `Workspace` по `id`).

Провижининг (`flor.service.provision`): из `workspace_id` → upsert `Workspace` (под платформенной
`Organization`-singleton) + `Membership(florusUserId, workspaceId, доменная-роль)`; worknet — стаб.

**Готовность проверена** (`npm run tenant:check`): чтение/запись/`count`/`findUnique` не
пересекают границу школы; запрос без тенанта (не system) → отказ. Каскад/гейт/аудит — на workspaceId.

> Тонкость: контекст активен в момент **await** запроса (Prisma `PrismaPromise` ленив).
> Интерсептор подписывается на обработчик внутри `TenantContext.run` — все await'ы в контексте.

## Дальнейшее усиление (не Фаза 0)
- **Postgres RLS**, ключ — `workspaceId`: `USING ("workspaceId" = current_setting('app.tenant')::uuid)`.
  Карта моделей готова.
- Bypass-политика для tenancy-ролей (operator/workspace_admin — агрегации панели).
- Синк `Worknet` из `florus_worknets[]` (claim Phase 1 Флёра) — сейчас стаб.
