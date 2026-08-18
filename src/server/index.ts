/**
 * Process entry point: an HTTP server for the static client and a WebSocket
 * server for the game, sharing one port so a single URL is all a player needs.
 */

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocketServer } from "ws";

import { config } from "./config.js";
import { ConnectionHub } from "./net/ConnectionHub.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("server");

// Two levels up lands on the project root from both `src/server` (tsx) and
// `dist/server` (compiled), so the static path needs no build-time branching.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = path.join(projectRoot, "public");

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: hub.rooms.size, uptime: process.uptime() });
});

app.use(
  express.static(publicDir, {
    // The bundle is rebuilt in place, so it must never be served stale.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// Single-page client: anything unmatched falls back to the shell so a shared
// deep link such as /ABCD opens the app rather than a 404.
app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const server = createServer(app);
const hub = new ConnectionHub();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxFrameBytes });

wss.on("connection", (socket) => hub.handleConnection(socket));

hub.start();

server.listen(config.port, config.host, () => {
  log.info(`WebWolf listening on http://${config.host}:${config.port}`);
});

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  hub.stop();
  wss.close();
  server.close(() => process.exit(0));
  // Do not let a half-open socket keep the process alive indefinitely.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
