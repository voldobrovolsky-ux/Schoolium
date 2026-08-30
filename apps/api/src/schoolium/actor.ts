import type { Request } from 'express';
import type { SchoolRole } from '@edustore/shared';
import type { SessionUser } from '../common/auth/flor.service';
import { SchoolError } from './schoolium.errors';

export interface SchoolActor {
  userId: string;
  workspaceId: string;
  roles: SchoolRole[];
  name: string;
}

/**
 * Идентичность действующего — из сессии, а не из тела запроса. Аудит модератора
 * (AR-88, ворота G-41) держится именно на ней: каждое его действие записывается
 * с идентичностью, и подменить её параметром нельзя.
 */
export function actorOf(req: Request & { user?: SessionUser }): SchoolActor {
  const u = req.user;
  if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
  return {
    userId: u.florusUserId,
    workspaceId: u.workspaceId,
    roles: (u.roles ?? []) as SchoolRole[],
    name: u.name,
  };
}
