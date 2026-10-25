import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import type { Env } from "../src/types.js";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
