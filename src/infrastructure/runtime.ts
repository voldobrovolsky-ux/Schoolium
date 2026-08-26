import { Pool } from "pg";
import { createClient, type RedisClientType } from "redis";

export interface HealthDependencies {
  check(): Promise<{ database: "ok"; sessionStore: "ok" } | { database: "unconfigured"; sessionStore: "unconfigured" }>;
  close(): Promise<void>;
}

class DevelopmentDependencies implements HealthDependencies {
  async check(): Promise<{ database: "unconfigured"; sessionStore: "unconfigured" }> {
    return { database: "unconfigured", sessionStore: "unconfigured" };
  }

  async close(): Promise<void> {}
}

class PostgresRedisDependencies implements HealthDependencies {
  public constructor(private readonly pool: Pool, private readonly redis: RedisClientType) {}

  async check(): Promise<{ database: "ok"; sessionStore: "ok" }> {
    await Promise.all([this.pool.query("SELECT 1"), this.redis.ping()]);
    return { database: "ok", sessionStore: "ok" };
  }

  async close(): Promise<void> {
    await Promise.all([this.pool.end(), this.redis.close()]);
  }
}

export const createRuntimeDependencies = async (): Promise<HealthDependencies> => {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl && !redisUrl) return new DevelopmentDependencies();
  if (!databaseUrl || !redisUrl) {
    throw new Error("DATABASE_URL and REDIS_URL must be configured together");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  const dependencies = new PostgresRedisDependencies(pool, redis);
  await dependencies.check();
  return dependencies;
};
