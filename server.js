// tiergrader: upload files, share links, and have people drag them into S/A/B/C/D/F tiers.
import { createApp } from "./src/app.js";

// Local dev reads .env; on Railway the variables come from the service settings.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

const PORT = Number(process.env.PORT) || 5190;
const server = createApp();
server.listen(PORT, () => {
  console.log(`tiergrader on http://localhost:${PORT} (who can create collections: ${server.authMode})`);
});

// Close live-update streams and idle keep-alive sockets so restarts and redeploys don't hang;
// give in-flight requests a few seconds at most.
const shutdown = () => {
  server.closeStreams();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
