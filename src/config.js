const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://mg-fashions.vercel.app"
];

function parseOrigins(raw) {
  if (!raw) return DEFAULT_CORS_ORIGINS;

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT) || 5000,

  jwtSecret:
    process.env.JWT_SECRET || "mg_fashions_local_secret",

  corsOrigins: parseOrigins(
    process.env.CORS_ORIGIN
  ),

  adminEmail:
    (process.env.ADMIN_EMAIL || "admin@mgfashions.com")
      .toLowerCase(),

  adminPassword:
    process.env.ADMIN_PASSWORD || "Admin@123",

  defaultProductImage:
    process.env.CLOUDINARY_DEFAULT_IMAGE_URL ||
    "https://res.cloudinary.com/dnjvjxmzq/image/upload/mg-fashions/placeholder.jpg",
};