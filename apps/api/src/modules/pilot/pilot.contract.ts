/**
 * ВРЕМЕННЫЙ пилотный auth (AUTH_MODE=pilot-qr). Разовый инструмент контролируемого запуска —
 * НЕ Флёр OIDC и НЕ dev-bypass x-florus-* заголовки (это разные вещи для разных целей).
 *
 * КРИТИЧНО: сессия, которую выдаёт QR-путь, должна нести ТУ ЖЕ форму (role/workspace_id claims),
 * что в итоге выдаст настоящий Флёр OIDC — чтобы нижестоящий RBAC не знал разницы и не требовал
 * спецкейсов при подключении Флёра. Поэтому маппинг роли делаем как в flor.service.provision():
 * teacher → (florusRole='teacher'); zavuch → (florusRole='staff', subRole='zavuch').
 */
export const AUTH_MODE_PILOT = 'pilot-qr';

// ПОСТОЯННЫЙ workspace_id школы «Архимед» — остаётся навсегда; настоящий Флёр позже прикрутится к
// этому же workspace (upsert по florusWorkspaceId), данные не переносим.
export const ARCHIMED_FLOR_WS_ID = 'ws-archimed-pilot';
export const ARCHIMED_NAME = 'Архимед';

export const PILOT_ROLES = ['teacher', 'zavuch'] as const;
export type PilotRole = (typeof PILOT_ROLES)[number];

/** Роль пилота → форма сессии Флёра (тот же shape, что выдаст OIDC-путь). */
export function toSessionRole(role: PilotRole): { florusRole: string; subRole: string | null } {
  return role === 'zavuch' ? { florusRole: 'staff', subRole: 'zavuch' } : { florusRole: 'teacher', subRole: null };
}

export interface CabinetState {
  state: 'preparing' | 'ready';
  message?: string; // спокойный статус-экран, без техдеталей
}
