/**
 * Client-side application state.
 *
 * Everything authoritative comes from the server snapshot; this store only
 * adds the few things the browser owns: connection status, the last error
 * banner, the clock offset used to draw countdowns, and the night selection
 * being assembled before it is sent.
 *
 * Seats, and why there can be two
 * -------------------------------
 * A device may seat two players sharing one phone. Each seat is a full player
 * server-side and receives its own redacted snapshot, so this store holds a
 * snapshot *per seat* rather than one.
 *
 * `activeSeatId` is the crux of the whole feature: it names the seat whose
 * private view is currently unlocked, and it is `null` by default. Nothing
 * secret reaches the screen until somebody has said, out loud and on purpose,
 * that the phone is now theirs - and it locks itself again the moment the
 * context changes underneath it.
 */

import type { ClientState, PlayerId } from "../shared/protocol.js";
import { slotKey, type CardSlot } from "../shared/roles.js";
import type { ConnectionStatus } from "./net/socket.js";

export interface AppState {
  status: ConnectionStatus;
  /** Seats this device holds, in the order the server lists them. */
  seatIds: PlayerId[];
  /** Latest redacted snapshot per seat, keyed by that seat's player id. */
  snapshots: Record<PlayerId, ClientState>;
  /** Seat whose private view is unlocked right now; null while locked. */
  activeSeatId: PlayerId | null;
  /** True while the "add a second player" form has the screen. */
  addingPlayer: boolean;
  /**
   * Seats that have acknowledged the role reveal on *this* device, before the
   * server has echoed it back. Without it the gate would briefly re-offer the
   * card of somebody who has just put the phone down.
   */
  acknowledged: PlayerId[];
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
  /**
   * French voices this device's speech engine offers. Populated once
   * `voiceschanged` fires; empty on engines that never raise it.
   */
  voices: SpeechSynthesisVoice[];
  /** URI of the narrator voice the host picked, or null for automatic. */
  voiceURI: string | null;
}

type Listener = (state: AppState) => void;

const NICKNAME_KEY = "webwolf.nickname";
const VOICE_KEY = "webwolf.voiceURI";

export class Store {
  private listeners: Listener[] = [];

  state: AppState = {
    status: "connecting",
    seatIds: [],
    snapshots: {},
    activeSeatId: null,
    addingPlayer: false,
    acknowledged: [],
    error: null,
    clockOffset: 0,
    selection: [],
    nickname: loadNickname(),
    voices: [],
    voiceURI: loadVoiceURI(),
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

  /* ---------------------------------------------------------------------- */
  /* Seats                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Snapshots for the seats on this device, in seat order. */
  get seats(): ClientState[] {
    return this.state.seatIds
      .map((id) => this.state.snapshots[id])
      .filter((snapshot): snapshot is ClientState => snapshot !== undefined);
  }

  /**
   * Any seat's snapshot, for reading the parts every seat agrees on: phase,
   * players, deck, settings, timers, and the end-of-round reveal.
   */
  get base(): ClientState | null {
    return this.seats[0] ?? null;
  }

  /** True when two players are sharing this phone. */
  get shared(): boolean {
    return this.state.seatIds.length > 1;
  }

  snapshotFor(seatId: PlayerId): ClientState | null {
    return this.state.snapshots[seatId] ?? null;
  }

  /** The unlocked seat's snapshot, or null while the phone is locked. */
  get active(): ClientState | null {
    const { activeSeatId } = this.state;
    return activeSeatId ? this.snapshotFor(activeSeatId) : null;
  }

  /** The seat on this device that narrates, if any of them does. */
  hostSeatId(): PlayerId | null {
    return this.seats.find((snapshot) => snapshot.isHost)?.youId ?? null;
  }

  get isHost(): boolean {
    return this.hostSeatId() !== null;
  }

  /**
   * Replaces the list of seats this device holds. Snapshots for seats that
   * are gone are dropped with it, so nothing they knew survives on screen.
   */
  setSeats(seatIds: PlayerId[]): void {
    const snapshots: Record<PlayerId, ClientState> = {};
    for (const id of seatIds) {
      const snapshot = this.state.snapshots[id];
      if (snapshot) snapshots[id] = snapshot;
    }
    const activeSeatId =
      this.state.activeSeatId && seatIds.includes(this.state.activeSeatId)
        ? this.state.activeSeatId
        : null;
    this.patch({ seatIds, snapshots, activeSeatId });
  }

  /** Forgets one seat, e.g. a companion who left or was removed. */
  dropSeat(seatId: PlayerId): void {
    this.setSeats(this.state.seatIds.filter((id) => id !== seatId));
  }

  /** Hands the screen to one seat: everything private is shown from now on. */
  openSeat(seatId: PlayerId): void {
    this.patch({ activeSeatId: seatId, selection: [] });
  }

  /** Takes the screen back. Nothing private is rendered while locked. */
  lockSeats(): void {
    if (this.state.activeSeatId === null && this.state.selection.length === 0) return;
    this.patch({ activeSeatId: null, selection: [] });
  }

  setAddingPlayer(addingPlayer: boolean): void {
    this.patch({ addingPlayer });
  }

  /** Records that a seat has seen its card, without waiting for the server. */
  markAcknowledged(seatId: PlayerId): void {
    if (this.state.acknowledged.includes(seatId)) return;
    this.patch({ acknowledged: [...this.state.acknowledged, seatId] });
  }

  /** True once this seat has confirmed its card, locally or per the server. */
  hasSeenCard(seatId: PlayerId): boolean {
    if (this.state.acknowledged.includes(seatId)) return true;
    return this.base?.players.find((player) => player.id === seatId)?.ready ?? false;
  }

  /* ---------------------------------------------------------------------- */
  /* Server state                                                           */
  /* ---------------------------------------------------------------------- */

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

  /** Refreshes the voices offered by this device's speech engine. */
  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.patch({ voices });
  }

  /** Remembers the narrator voice this device should use, or clears it. */
  setVoiceURI(voiceURI: string | null): void {
    try {
      if (voiceURI) localStorage.setItem(VOICE_KEY, voiceURI);
      else localStorage.removeItem(VOICE_KEY);
    } catch {
      // Storage unavailable; the choice simply is not remembered.
    }
    this.patch({ voiceURI });
  }

  /**
   * Applies a server snapshot to the seat it belongs to.
   *
   * A change of context (new phase, new night step, new round) drops the
   * in-progress night selection *and* re-locks the phone. The lock matters
   * most on the way out of the night: a shared device left open on one seat
   * would otherwise put that seat's ballot in front of whoever holds the phone.
   */
  applyServerState(next: ClientState): void {
    const previous = this.state.snapshots[next.youId];
    const contextChanged =
      !previous ||
      previous.phase !== next.phase ||
      previous.round !== next.round ||
      previous.night?.step !== next.night?.step;

    // A snapshot can arrive before its `welcome`, e.g. when a companion is
    // seated; keep the seat rather than dropping the frame.
    const seatIds = this.state.seatIds.includes(next.youId)
      ? this.state.seatIds
      : [...this.state.seatIds, next.youId];

    this.state = {
      ...this.state,
      seatIds,
      snapshots: { ...this.state.snapshots, [next.youId]: next },
      activeSeatId: contextChanged ? null : this.state.activeSeatId,
      // Seating a companion is a lobby-only affair; a round starting under an
      // open form must not leave it covering the reveal.
      addingPlayer: next.phase === "lobby" && this.state.addingPlayer,
      acknowledged: contextChanged ? [] : this.state.acknowledged,
      clockOffset: next.serverNow - Date.now(),
      selection: contextChanged ? [] : this.state.selection,
      error: contextChanged ? null : this.state.error,
    };
    this.notify();
  }

  /** Clears everything room-related, e.g. after leaving or being kicked. */
  clearRoom(): void {
    this.patch({
      seatIds: [],
      snapshots: {},
      activeSeatId: null,
      addingPlayer: false,
      acknowledged: [],
      selection: [],
    });
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
    const timer = this.base?.timer;
    if (!timer) return null;
    return Math.max(0, timer.endsAt - (Date.now() + this.state.clockOffset));
  }

  playerName(playerId: PlayerId): string {
    const player = this.base?.players.find((candidate) => candidate.id === playerId);
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

function loadVoiceURI(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}
