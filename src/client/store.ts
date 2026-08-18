/**
 * Client-side application state.
 *
 * Everything authoritative comes from the server snapshot; this store only
 * adds the few things the browser owns: connection status, the last error
 * banner, the clock offset used to draw countdowns, and the night selection
 * being assembled before it is sent.
 */

import type { ClientState, PlayerId } from "../shared/protocol.js";
import { slotKey, type CardSlot } from "../shared/roles.js";
import type { ConnectionStatus } from "./net/socket.js";

export interface AppState {
  status: ConnectionStatus;
  /** Latest redacted snapshot, or null before we are seated. */
  server: ClientState | null;
  /** Transient banner, cleared on the next successful action. */
  error: string | null;
  /**
   * `serverTime - clientTime`, refreshed on every snapshot. Countdowns are
   * drawn against it so a device with a skewed clock still shows the truth.
   */
  clockOffset: number;
  /** Night slots tapped so far, not yet forming a complete selection. */
  selection: CardSlot[];
  /** Remembered between rounds so a rejoin does not ask for it again. */
  nickname: string;
}

type Listener = (state: AppState) => void;

const NICKNAME_KEY = "webwolf.nickname";

export class Store {
  private listeners: Listener[] = [];

  state: AppState = {
    status: "connecting",
    server: null,
    error: null,
    clockOffset: 0,
    selection: [],
    nickname: loadNickname(),
  };

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  patch(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  setStatus(status: ConnectionStatus): void {
    this.patch({ status });
  }

  setError(error: string | null): void {
    this.patch({ error });
  }

  setNickname(nickname: string): void {
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch {
      // Storage unavailable; the nickname simply is not remembered.
    }
    this.patch({ nickname });
  }

  /**
   * Applies a server snapshot.
   *
   * The in-progress night selection is dropped whenever the turn context
   * changes (new phase, new night step, new round). Without that, a tap left
   * over from the previous step could be submitted against the next role.
   */
  applyServerState(next: ClientState): void {
    const previous = this.state.server;
    const contextChanged =
      !previous ||
      previous.phase !== next.phase ||
      previous.round !== next.round ||
      previous.night?.step !== next.night?.step;

    this.state = {
      ...this.state,
      server: next,
      clockOffset: next.serverNow - Date.now(),
      selection: contextChanged ? [] : this.state.selection,
      error: contextChanged ? null : this.state.error,
    };
    this.notify();
  }

  /** Clears everything room-related, e.g. after leaving or being kicked. */
  clearRoom(): void {
    this.patch({ server: null, selection: [] });
  }

  setSelection(selection: CardSlot[]): void {
    this.patch({ selection });
  }

  isSelected(slot: CardSlot): boolean {
    const key = slotKey(slot);
    return this.state.selection.some((candidate) => slotKey(candidate) === key);
  }

  /** Milliseconds left on the current phase timer, or null if there is none. */
  remainingMs(): number | null {
    const timer = this.state.server?.timer;
    if (!timer) return null;
    return Math.max(0, timer.endsAt - (Date.now() + this.state.clockOffset));
  }

  playerName(playerId: PlayerId): string {
    const player = this.state.server?.players.find((candidate) => candidate.id === playerId);
    return player?.nickname ?? "?";
  }
}

function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}
