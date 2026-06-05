const { startServer } = require("./src/server");

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start MG backend:", error);
  process.exit(1);
});
