/**
 * Room lifecycle: creation, lookup by code, host hand-over and garbage
 * collection.
 *
 * Rooms live in memory only. That is a deliberate scope choice for a party
 * game played in one sitting: a restart drops every table, but nothing needs
 * a database, and there is no personal data at rest. Swapping this map for a
 * store is the natural first step if rounds ever need to survive a deploy -
 * `Room` is already free of any I/O.
 */

import { config } from "../config.js";
import { createLogger } from "../util/logger.js";
import { newRoomCode } from "../util/random.js";
import { Room, type RoomCallbacks } from "./Room.js";

const log = createLogger("rooms");

/** Give up generating a fresh code after this many collisions. */
const MAX_CODE_ATTEMPTS = 200;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private reaper: NodeJS.Timeout | null = null;

  constructor(private readonly callbacks: RoomCallbacks) {}

  get size(): number {
    return this.rooms.size;
  }

  create(): Room {
    const code = this.allocateCode();
    const room = new Room(code, this.callbacks);
    this.rooms.set(code, room);
    log.info(`created room ${code} (${this.rooms.size} open)`);
    return room;
  }

  /** Codes are case-insensitive; players read them out loud. */
  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
    log.info(`closed room ${code} (${this.rooms.size} open)`);
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = newRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    // Every 4-letter code is taken, which needs ~83k concurrent rooms. Failing
    // loudly beats handing out a duplicate that would merge two tables.
    throw new Error("Unable to allocate a free room code");
  }

  /**
   * Periodic maintenance: promote a new host when the current one has been
   * gone too long, and drop rooms nobody has been connected to for a while.
   */
  startMaintenance(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.sweep(), config.reaperIntervalMs);
    // Housekeeping must never hold the process open on its own.
    this.reaper.unref?.();
  }

  stopMaintenance(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.reassignHostIfNeeded(config.hostGraceMs);

      if (room.playerCount === 0) {
        this.destroy(code);
        continue;
      }

      const idleSince = room.idleSince;
      if (idleSince !== null && now - idleSince > config.roomTtlMs) {
        log.info(`reaping idle room ${code}`);
        this.destroy(code);
      }
    }
  }
}

export function normalizeCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}
