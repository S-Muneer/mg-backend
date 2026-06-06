import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

function withSslModeRequire(url) {
  if (!url) return url;
  if (/sslmode=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

const pool = new Pool({ connectionString: withSslModeRequire(connectionString) });
const adapter = new PrismaPg(pool);

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    adapter,
  },
});