const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");

dotenv.config();

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL (or NEON_DATABASE_URL) is not configured");
}

function withSslModeRequire(url) {
  if (/sslmode=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

const pool = new Pool({ connectionString: withSslModeRequire(connectionString) });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
