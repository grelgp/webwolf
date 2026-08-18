/**
 * The commands a screen can trigger.
 *
 * Screens are pure render functions over `(store, actions)`; they never touch
 * the socket directly. Keeping the surface in one interface makes it obvious
 * what the UI is allowed to do, and lets screens be exercised against a stub.
 */

import type { RoomSettings } from "../shared/constants.js";
import type { PlayerId } from "../shared/protocol.js";
import type { CardSlot, RoleId } from "../shared/roles.js";

export interface Actions {
  createRoom(nickname: string): void;
  joinRoom(code: string, nickname: string): void;
  leaveRoom(): void;

  setDeck(counts: Partial<Record<RoleId, number>>): void;
  setSettings(patch: Partial<RoomSettings>): void;
  kickPlayer(playerId: PlayerId): void;
  startGame(): void;

  /** Acknowledges the role reveal. */
  ready(): void;

  /**
   * Taps one card slot during the night. The store accumulates taps until they
   * satisfy one of the role's selection groups, then submits automatically -
   * which is what keeps every night action down to one or two taps.
   */
  tapSlot(slot: CardSlot): void;
  skipNight(): void;

  endDiscussion(): void;
  castVote(targetId: PlayerId): void;
  playAgain(): void;

  /** Lobby-only: speaks a sample line so the host can set the volume. */
  testVoice(): void;
}
