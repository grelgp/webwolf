/**
 * Randomness helpers.
 *
 * Everything here goes through `node:crypto` rather than `Math.random`. The
 * deal decides the whole round, so a predictable shuffle would be a real
 * exploit, not a theoretical one.
 */

import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../../shared/constants.js";

/** Opaque, unguessable player identifier. */
export function newPlayerId(): string {
  return randomUUID();
}

/**
 * Resume credential. Paired with a player id it lets a refreshed browser
 * reclaim its seat - and stops anyone else from claiming it by guessing an id.
 */
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Fisher-Yates, on a copy. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
