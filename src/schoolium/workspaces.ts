import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../shared/errors.js";
import { newId, now } from "../shared/ids.js";

export type WorkspaceStatus = "creating" | "created" | "deleted";
export type WorkspaceRole = "super_admin" | "moderator" | "director" | "psychologist" | "teacher" | "parent" | "student";

export interface Workspace {
  id: string;
  title: string;
  status: WorkspaceStatus;
  createdAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  identityId: string;
  role: WorkspaceRole;
  status: "active" | "revoked";
  createdAt: string;
}

const PERMISSIONS: Readonly<Record<WorkspaceRole, readonly string[]>> = {
  super_admin: ["workspace:create", "workspace:manage", "schoolium:admin"],
  moderator: ["workspace:manage", "membership:manage"],
  director: ["school:read", "school:manage"],
  psychologist: ["consultation:read", "consultation:write"],
  teacher: ["class:read", "assessment:write"],
  parent: ["child:read"],
  student: ["self:read"],
};

/** Product-local authorization. No method accepts an IDP group as evidence of a permission. */
export class WorkspaceService {
  readonly #workspaces = new Map<string, Workspace>();
  readonly #memberships = new Map<string, WorkspaceMembership[]>();

  createWorkspace(creatorIdentityId: string, title: string): Workspace {
    if (!creatorIdentityId || !title.trim()) {
      throw new ValidationError("creatorIdentityId and title are required");
    }
    const workspace: Workspace = { id: newId(), title, status: "creating", createdAt: now() };
    this.#workspaces.set(workspace.id, workspace);
    workspace.status = "created";
    this.addMembership(workspace.id, creatorIdentityId, "moderator");
    return { ...workspace };
  }

  addMembership(workspaceId: string, identityId: string, role: WorkspaceRole): WorkspaceMembership {
    const workspace = this.requireWorkspace(workspaceId);
    if (workspace.status !== "created") {
      throw new ConflictError("Workspace is not available for memberships");
    }
    if (!identityId) {
      throw new ValidationError("identityId is required");
    }
    const memberships = this.#memberships.get(workspaceId) ?? [];
    const existing = memberships.find((membership) => membership.identityId === identityId && membership.status === "active");
    if (existing) {
      throw new ConflictError("Identity already has an active workspace membership");
    }
    const membership: WorkspaceMembership = { workspaceId, identityId, role, status: "active", createdAt: now() };
    memberships.push(membership);
    this.#memberships.set(workspaceId, memberships);
    return { ...membership };
  }

  listWorkspaces(identityId: string): Array<Workspace & { membership: WorkspaceMembership }> {
    return [...this.#workspaces.values()]
      .filter((workspace) => workspace.status === "created")
      .flatMap((workspace) => {
        const membership = this.#memberships.get(workspace.id)?.find((item) => item.identityId === identityId && item.status === "active");
        return membership ? [{ ...workspace, membership: { ...membership } }] : [];
      });
  }

  authorize(workspaceId: string, identityId: string, permission: string): boolean {
    this.requireWorkspace(workspaceId);
    const membership = this.#memberships.get(workspaceId)?.find((item) => item.identityId === identityId && item.status === "active");
    return Boolean(membership && PERMISSIONS[membership.role].includes(permission));
  }

  requirePermission(workspaceId: string, identityId: string, permission: string): void {
    if (!this.authorize(workspaceId, identityId, permission)) {
      throw new ForbiddenError();
    }
  }

  private requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.#workspaces.get(workspaceId);
    if (!workspace || workspace.status === "deleted") {
      throw new NotFoundError();
    }
    return workspace;
  }
}
