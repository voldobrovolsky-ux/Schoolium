import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/shared/errors.js";
import { GroupService } from "../src/idp/groups.js";

describe("GroupService", () => {
  it("hides groups from clients outside audience", () => {
    const groups = new GroupService();
    const group = groups.createGroup("schoolium", "family");

    expect(() => groups.getGroup("other-product", group.id)).toThrow(NotFoundError);
  });

  it("does not allow an audience client to mutate another client's group", () => {
    const groups = new GroupService();
    const group = groups.createGroup("schoolium", "family", ["other-product"]);

    expect(() => groups.inviteMember("other-product", group.id, "identity-a", "parent")).toThrow(ForbiddenError);
  });

  it("requires the invited identity to confirm membership", () => {
    const groups = new GroupService();
    const group = groups.createGroup("schoolium", "family");
    groups.inviteMember("schoolium", group.id, "identity-a", "parent");

    const membership = groups.confirmMember(group.id, "identity-a");

    expect(membership.status).toBe("active");
    expect(groups.getGroup("schoolium", group.id).memberships[0]?.status).toBe("active");
  });
});
