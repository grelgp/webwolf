/**
 * Server tunables. Everything is overridable through the environment so the
 * same build runs locally and on a host that dictates its own port.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: intFromEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * How long a disconnected host keeps the room before the seat passes to the
   * next connected player. Long enough to survive a tunnel or a screen lock,
   * short enough that a table is never stuck without a narrator.
   */
  hostGraceMs: intFromEnv("HOST_GRACE_MS", 30_000),

  /**
   * A room with no connected player is dropped after this long. Reconnecting
   * within the window restores the round exactly where it was.
   */
  roomTtlMs: intFromEnv("ROOM_TTL_MS", 30 * 60_000),

  /** Sweep interval for the room reaper. */
  reaperIntervalMs: intFromEnv("REAPER_INTERVAL_MS", 60_000),

  /** WebSocket keepalive; sockets that miss two pings are torn down. */
  heartbeatMs: intFromEnv("HEARTBEAT_MS", 25_000),

  /** Rejects oversized frames before they are parsed. */
  maxFrameBytes: intFromEnv("MAX_FRAME_BYTES", 8 * 1024),

  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
} as const;
