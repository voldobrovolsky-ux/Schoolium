import { afterEach, describe, expect, it } from "vitest";
import { buildIdpApi } from "../src/idp/app.js";
import { buildSchooliumApp } from "../src/schoolium/app.js";

describe("HTTP applications", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("returns 404 instead of revealing a hidden group", async () => {
    const app = buildIdpApi();
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/groups", headers: { "x-client-id": "schoolium", "x-scopes": "groups:write" }, payload: { tag: "family" } });
    const group = created.json() as { id: string };

    const response = await app.inject({ method: "GET", url: `/groups/${group.id}`, headers: { "x-client-id": "other", "x-scopes": "groups:read" } });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("does not grant school permissions because an identity header is present", async () => {
    const app = buildSchooliumApp();
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/workspaces", headers: { "x-identity-id": "moderator" }, payload: { title: "School 5" } });
    const school = created.json() as { id: string };

    const response = await app.inject({ method: "GET", url: `/workspaces/${school.id}/permissions/consultation:read`, headers: { "x-identity-id": "moderator" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ allowed: false });
  });
});
