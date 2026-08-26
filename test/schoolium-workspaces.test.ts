import { describe, expect, it } from "vitest";
import { WorkspaceService } from "../src/schoolium/workspaces.js";

describe("WorkspaceService", () => {
  it("uses only product-local membership to grant permissions", () => {
    const workspaces = new WorkspaceService();
    const school = workspaces.createWorkspace("moderator", "School 5");
    workspaces.addMembership(school.id, "psychologist", "psychologist");

    expect(workspaces.authorize(school.id, "psychologist", "consultation:read")).toBe(true);
    expect(workspaces.authorize(school.id, "moderator", "consultation:read")).toBe(false);
  });

  it("keeps membership independent across workspaces", () => {
    const workspaces = new WorkspaceService();
    const first = workspaces.createWorkspace("person", "School 1");
    const second = workspaces.createWorkspace("other", "School 2");
    workspaces.addMembership(second.id, "person", "parent");

    const memberships = workspaces.listWorkspaces("person");

    expect(memberships).toHaveLength(2);
    expect(memberships.map((item) => item.membership.role)).toEqual(expect.arrayContaining(["moderator", "parent"]));
    expect(workspaces.authorize(first.id, "person", "child:read")).toBe(false);
    expect(workspaces.authorize(second.id, "person", "child:read")).toBe(true);
  });
});
