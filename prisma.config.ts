import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL_UNPOOLED"),
    // Only needed locally for `prisma migrate diff`/`dev` against a migrations
    // directory; production `migrate deploy` never touches a shadow db, so this
    // is safely undefined there.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
