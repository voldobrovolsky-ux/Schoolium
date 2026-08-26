import type { FastifyInstance, FastifyReply } from "fastify";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (error instanceof ForbiddenError) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: "conflict", error_description: error.message });
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: "invalid_request", error_description: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "server_error" });
  });
};

export const requireTextHeader = (reply: FastifyReply, value: string | string[] | undefined, name: string): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  reply.code(401).send({ error: "unauthorized", error_description: `${name} is required` });
  return undefined;
};
