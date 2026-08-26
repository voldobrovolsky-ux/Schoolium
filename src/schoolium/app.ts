import Fastify, { type FastifyInstance } from "fastify";
import type { HealthDependencies } from "../infrastructure/runtime.js";
import { registerErrorHandler, requireTextHeader } from "../shared/http.js";
import { WorkspaceService, type WorkspaceRole } from "./workspaces.js";

export const buildSchooliumApp = (service = new WorkspaceService(), dependencies?: HealthDependencies): FastifyInstance => {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);

  app.get("/health", async () => ({ status: "ok", dependencies: await dependencies?.check() }));

  app.post<{ Body: { title?: string } }>("/workspaces", async (request, reply) => {
    const identityId = requireTextHeader(reply, request.headers["x-identity-id"], "x-identity-id");
    if (!identityId) return;
    return reply.code(201).send(service.createWorkspace(identityId, request.body?.title ?? ""));
  });

  app.post<{ Params: { workspaceId: string }; Body: { identityId?: string; role?: WorkspaceRole } }>("/workspaces/:workspaceId/members", async (request, reply) => {
    const actorIdentityId = requireTextHeader(reply, request.headers["x-identity-id"], "x-identity-id");
    if (!actorIdentityId) return;
    service.requirePermission(request.params.workspaceId, actorIdentityId, "workspace:manage");
    const role = request.body?.role;
    if (!role) return reply.code(400).send({ error: "invalid_request", error_description: "role is required" });
    return reply.code(201).send(service.addMembership(request.params.workspaceId, request.body?.identityId ?? "", role));
  });

  app.get("/me/workspaces", async (request, reply) => {
    const identityId = requireTextHeader(reply, request.headers["x-identity-id"], "x-identity-id");
    if (!identityId) return;
    return { items: service.listWorkspaces(identityId) };
  });

  app.get<{ Params: { workspaceId: string; permission: string } }>("/workspaces/:workspaceId/permissions/:permission", async (request, reply) => {
    const identityId = requireTextHeader(reply, request.headers["x-identity-id"], "x-identity-id");
    if (!identityId) return;
    return { allowed: service.authorize(request.params.workspaceId, identityId, request.params.permission) };
  });

  return app;
};
