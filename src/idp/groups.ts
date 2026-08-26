import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../shared/errors.js";
import { newId, now } from "../shared/ids.js";

export type GroupStatus = "active" | "dissolved";
export type MembershipStatus = "pending" | "active" | "rejected" | "revoked";

export interface Membership {
  id: string;
  identityId: string;
  role: string;
  status: MembershipStatus;
  joinedAt?: string;
}

export interface Group {
  id: string;
  tag: string;
  createdByClientId: string;
  audience: string[];
  status: GroupStatus;
  createdAt: string;
  memberships: Membership[];
}

export interface MembershipInvitation {
  membershipId: string;
  status: "pending";
}

/**
 * Domain implementation of the IDP relationship boundary. It deliberately does
 * not expose product permissions or tenant data: group membership is a fact,
 * not authorization.
 */
export class GroupService {
  readonly #groups = new Map<string, Group>();

  createGroup(clientId: string, tag: string, requestedAudience?: readonly string[]): Group {
    if (!clientId || !tag.trim()) {
      throw new ValidationError("clientId and tag are required");
    }
    const audience = new Set([clientId, ...(requestedAudience ?? [])]);
    const group: Group = {
      id: newId(),
      tag,
      createdByClientId: clientId,
      audience: [...audience],
      status: "active",
      createdAt: now(),
      memberships: [],
    };
    this.#groups.set(group.id, group);
    return this.clone(group);
  }

  getGroup(clientId: string, groupId: string): Group {
    const group = this.#groups.get(groupId);
    if (!group || !group.audience.includes(clientId)) {
      // Deliberately non-enumerating: clients cannot distinguish missing from hidden.
      throw new NotFoundError();
    }
    return this.clone(group);
  }

  listGroupsForIdentity(clientId: string, identityId: string): Group[] {
    return [...this.#groups.values()]
      .filter((group) => group.audience.includes(clientId))
      .filter((group) => group.memberships.some((membership) => membership.identityId === identityId))
      .map((group) => this.clone(group));
  }

  replaceAudience(clientId: string, groupId: string, requestedAudience: readonly string[]): Group {
    const group = this.requireOwnedActiveGroup(clientId, groupId);
    group.audience = [...new Set([clientId, ...requestedAudience])];
    return this.clone(group);
  }

  inviteMember(clientId: string, groupId: string, identityId: string, role: string): MembershipInvitation {
    const group = this.requireOwnedActiveGroup(clientId, groupId);
    if (!identityId || !role.trim()) {
      throw new ValidationError("identityId and role are required");
    }
    const existing = group.memberships.find((membership) => membership.identityId === identityId);
    if (existing && existing.status !== "revoked" && existing.status !== "rejected") {
      throw new ConflictError("Identity already has an active or pending membership");
    }
    const membership: Membership = {
      id: newId(),
      identityId,
      role,
      status: "pending",
    };
    if (existing) {
      group.memberships = group.memberships.filter((item) => item.id !== existing.id);
    }
    group.memberships.push(membership);
    return { membershipId: membership.id, status: "pending" };
  }

  confirmMember(groupId: string, identityId: string): Membership {
    const group = this.#groups.get(groupId);
    const membership = group?.memberships.find((item) => item.identityId === identityId);
    if (!group || group.status !== "active" || !membership || membership.status !== "pending") {
      throw new NotFoundError();
    }
    membership.status = "active";
    membership.joinedAt = now();
    return { ...membership };
  }

  revokeMember(clientId: string, groupId: string, identityId: string): void {
    const group = this.requireOwnedActiveGroup(clientId, groupId);
    const membership = group.memberships.find((item) => item.identityId === identityId);
    if (!membership) {
      throw new NotFoundError();
    }
    membership.status = "revoked";
  }

  dissolveGroup(clientId: string, groupId: string): void {
    const group = this.requireOwnedActiveGroup(clientId, groupId);
    group.status = "dissolved";
    for (const membership of group.memberships) {
      if (membership.status === "active" || membership.status === "pending") {
        membership.status = "revoked";
      }
    }
  }

  private requireOwnedActiveGroup(clientId: string, groupId: string): Group {
    const group = this.#groups.get(groupId);
    if (!group || !group.audience.includes(clientId)) {
      throw new NotFoundError();
    }
    if (group.createdByClientId !== clientId) {
      throw new ForbiddenError("Only the owning client may mutate a group");
    }
    if (group.status !== "active") {
      throw new ConflictError("Group is dissolved");
    }
    return group;
  }

  private clone(group: Group): Group {
    return { ...group, audience: [...group.audience], memberships: group.memberships.map((membership) => ({ ...membership })) };
  }
}
