import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandler, requireTextHeader } from "../shared/http.js";
import { GroupService } from "./groups.js";

const requireScope = (scopeHeader: string | string[] | undefined, scope: string): boolean =>
  typeof scopeHeader === "string" && scopeHeader.split(" ").includes(scope);

/**
 * Group API development adapter. It uses explicit development headers only and
 * refuses to start outside a local development/test process. Production must
 * replace this with verified OIDC access-token middleware.
 */
export const buildIdpApi = (groups = new GroupService()): FastifyInstance => {
  const app = Fastify({ logger: true });
  registerErrorHandler(app);

  app.addHook("onRequest", async (request, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.code(503).send({ error: "configuration_required", error_description: "OIDC resource-server middleware is required in production" });
    }
    if (request.url === "/health") return;
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
  });

  app.get("/health", async () => ({ status: "ok", mode: "development" }));

  app.post<{ Body: { tag?: string; audience?: string[] } }>("/groups", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:write")) return reply.code(403).send({ error: "insufficient_scope" });
    return reply.code(201).send(groups.createGroup(clientId, request.body?.tag ?? "", request.body?.audience));
  });

  app.get<{ Params: { groupId: string } }>("/groups/:groupId", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:read")) return reply.code(403).send({ error: "insufficient_scope" });
    return groups.getGroup(clientId, request.params.groupId);
  });

  app.patch<{ Params: { groupId: string }; Body: { audience?: string[] } }>("/groups/:groupId/audience", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:write")) return reply.code(403).send({ error: "insufficient_scope" });
    return groups.replaceAudience(clientId, request.params.groupId, request.body?.audience ?? []);
  });

  app.post<{ Params: { groupId: string }; Body: { identityId?: string; role?: string } }>("/groups/:groupId/members", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:write")) return reply.code(403).send({ error: "insufficient_scope" });
    return reply.code(202).send(groups.inviteMember(clientId, request.params.groupId, request.body?.identityId ?? "", request.body?.role ?? ""));
  });

  app.post<{ Params: { groupId: string; identityId: string } }>("/groups/:groupId/members/:identityId/confirm", async (request, reply) => {
    const identityId = requireTextHeader(reply, request.headers["x-identity-id"], "x-identity-id");
    if (!identityId || identityId !== request.params.identityId) return reply.code(403).send({ error: "forbidden" });
    return groups.confirmMember(request.params.groupId, identityId);
  });

  app.delete<{ Params: { groupId: string; identityId: string } }>("/groups/:groupId/members/:identityId", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:write")) return reply.code(403).send({ error: "insufficient_scope" });
    groups.revokeMember(clientId, request.params.groupId, request.params.identityId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { groupId: string } }>("/groups/:groupId", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:write")) return reply.code(403).send({ error: "insufficient_scope" });
    groups.dissolveGroup(clientId, request.params.groupId);
    return reply.code(204).send();
  });

  app.get<{ Params: { identityId: string } }>("/identities/:identityId/groups", async (request, reply) => {
    const clientId = requireTextHeader(reply, request.headers["x-client-id"], "x-client-id");
    if (!clientId) return;
    if (!requireScope(request.headers["x-scopes"], "groups:read")) return reply.code(403).send({ error: "insufficient_scope" });
    return { items: groups.listGroupsForIdentity(clientId, request.params.identityId) };
  });

  return app;
};
