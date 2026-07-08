import http from "http";
import app from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/database";
import { createSocketServer } from "./config/socket";
import { registerSockets } from "./sockets";
import { startAutoLockWorker, stopAutoLockWorker } from "./workers/auto-lock";
import { startLiveReconciler, stopLiveReconciler } from "./workers/live-meeting-reconciler";
import { startMeetingReminderWorker, stopMeetingReminderWorker } from "./workers/meeting-reminder";

async function main() {
  // 1. Validate environment (already done by env.ts import)
  logger.info("Environment validated");

  // 2. Verify database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connectivity verified");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Database connection failed: ${msg}`);
    process.exit(1);
  }

  // 3. Start HTTP server / Socket.IO
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  registerSockets(io);

  httpServer.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`Server running on http://0.0.0.0:${env.PORT}`);
  });

  // 4. Start background workers (only after DB confirmed)
  startAutoLockWorker();
  startLiveReconciler();
  startMeetingReminderWorker();

  function gracefulShutdown() {
    logger.info("Shutting down gracefully...");
    stopAutoLockWorker();
    stopLiveReconciler();
    stopMeetingReminderWorker();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  }

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});

export default app;
