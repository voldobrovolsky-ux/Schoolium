import type { Request } from 'express';
import { SCHOOL_PERMISSIONS, type SchoolPermission, type SchoolRole } from '@edustore/shared';
import type { SessionUser } from '../common/auth/flor.service';
import { SchoolError } from './schoolium.errors';

export interface SchoolActor {
  userId: string;
  workspaceId: string;
  roles: SchoolRole[];
  name: string;
  /**
   * Действующие права запроса — резолв `PermissionGuard` со школьными правками
   * (AR-213). Пусто у негейченного роута: там `actorHas` падает обратно на
   * пакет ролей версии.
   */
  permissions?: SchoolPermission[];
}

/**
 * Идентичность действующего — из сессии, а не из тела запроса. Аудит модератора
 * (AR-88, ворота G-41) держится именно на ней: каждое его действие записывается
 * с идентичностью, и подменить её параметром нельзя.
 */
export function actorOf(req: Request & { user?: SessionUser; permissions?: string[] }): SchoolActor {
  const u = req.user;
  if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
  const resolved = req.permissions?.filter((c): c is SchoolPermission =>
    (SCHOOL_PERMISSIONS as readonly string[]).includes(c),
  );
  return {
    userId: u.florusUserId,
    workspaceId: u.workspaceId,
    roles: (u.roles ?? []) as SchoolRole[],
    name: u.name,
    ...(resolved ? { permissions: resolved } : {}),
  };
}
