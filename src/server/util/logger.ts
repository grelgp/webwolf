/**
 * Minimal levelled logger.
 *
 * Deliberately tiny and dependency-free. It exists mainly so that room and
 * game code can log with a stable prefix, and so that debug tracing of the
 * night can be switched on with `LOG_LEVEL=debug` without shipping a logging
 * framework.
 *
 * Never log dealt roles at `info`: server logs are the one place where the
 * whole point of this app (nobody sees anyone else's card) could leak.
 */

import { config } from "../config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

type Level = keyof typeof LEVELS;

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (extra === undefined) {
    console[level === "debug" ? "log" : level](line);
  } else {
    console[level === "debug" ? "log" : level](line, extra);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => emit("debug", scope, message, extra),
    info: (message: string, extra?: unknown) => emit("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => emit("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => emit("error", scope, message, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
