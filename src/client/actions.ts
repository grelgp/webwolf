/**
 * The commands a screen can trigger.
 *
 * Screens are pure render functions over `(store, actions)`; they never touch
 * the socket directly. Keeping the surface in one interface makes it obvious
 * what the UI is allowed to do, and lets screens be exercised against a stub.
 *
 * Anything a *player* does takes an explicit `seat`, because a device can hold
 * two of them and the screen always knows which one it is showing. Anything
 * the *host* does does not: there is at most one host seat per device, and the
 * implementation resolves it.
 */

import type { RoomSettings } from "../shared/constants.js";
import type { PlayerId } from "../shared/protocol.js";
import type { CardSlot, RoleId } from "../shared/roles.js";

export interface Actions {
  createRoom(nickname: string): void;
  joinRoom(code: string, nickname: string): void;
  /** Seats a second player on this device, sharing the screen with the first. */
  addPlayer(nickname: string): void;
  /** Releases one seat, or the whole device when `seat` is omitted. */
  leaveRoom(seat?: PlayerId): void;

  setDeck(counts: Partial<Record<RoleId, number>>): void;
  setSettings(patch: Partial<RoomSettings>): void;
  kickPlayer(playerId: PlayerId): void;
  startGame(): void;

  /** Acknowledges the role reveal for one seat, and re-locks the screen. */
  ready(seat: PlayerId): void;

  /**
   * Taps one card slot during the night. The store accumulates taps until they
   * satisfy one of the role's selection groups, then submits automatically -
   * which is what keeps every night action down to one or two taps.
   */
  tapSlot(seat: PlayerId, slot: CardSlot): void;
  skipNight(seat: PlayerId): void;

  endDiscussion(): void;
  castVote(seat: PlayerId, targetId: PlayerId): void;
  playAgain(): void;

  /** Lobby-only: speaks a sample line so the host can set the volume. */
  testVoice(): void;

  /**
   * Lobby-only: picks which installed voice narrates, by URI, or `null` to
   * let the engine choose. Purely local to this device, not a room setting.
   */
  setVoice(voiceURI: string | null): void;
}
