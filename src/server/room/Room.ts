/**
 * One room: its seats, its settings, and the phase machine for a round.
 *
 * `Room` owns all game state and is the only place it mutates. It knows
 * nothing about sockets - it reports "something changed" and "say this out
 * loud" through callbacks, and `ConnectionHub` turns those into frames. That
 * boundary is what makes the room testable without a network.
 *
 * Every phase transition goes through `enterPhase`, and every deadline through
 * `setDeadline`, so there is exactly one timer per room and no way to leave a
 * stray one running.
 */

import {
  DEFAULT_SETTINGS,
  MAX_SEATS_PER_DEVICE,
  MIN_PLAYERS,
  NICKNAME_MAX_LENGTH,
  NIGHT_SETTLE_SECONDS,
  NUMERIC_SETTING_KEYS,
  SETTINGS_BOUNDS,
  type RoomSettings,
} from "../../shared/constants.js";
import type { CardSlot, RoleId } from "../../shared/roles.js";
import {
  ROLES,
  getRole,
  maxSupportedPlayers,
  wakeOrderForDeck,
} from "../../shared/roles.js";
import type { ErrorCode, Phase, PlayerId, RoundResult } from "../../shared/protocol.js";
import {
  countsToDeck,
  suggestDeck,
  validateDeck,
  type DeckCounts,
} from "../../shared/deck.js";
import { dealCards } from "../game/deal.js";
import {
  createNightState,
  currentRole,
  getTurnState,
  holdersOf,
  isValidSlot,
  scriptedRole,
  type NightState,
} from "../game/nightState.js";
import { ROLE_HANDLERS, TURN_START_HANDLERS, validateSelection } from "../game/roleHandlers.js";
import { applyHunterShots, countVotes, decideOutcome } from "../game/resolution.js";
import { createLogger } from "../util/logger.js";
import { newPlayerId, newToken } from "../util/random.js";

export interface Player {
  id: PlayerId;
  /** Resume credential; never leaves the server except to its own owner. */
  token: string;
  nickname: string;
  /**
   * The device this seat is played on. Two seats sharing one are two real
   * players with their own cards and votes; they simply pass the phone.
   */
  deviceId: string;
  connected: boolean;
  /** Epoch ms of the last disconnect, used for host hand-over and room TTL. */
  disconnectedAt: number | null;
  /** Acknowledged the role reveal this round. */
  ready: boolean;
}

/** Outcome of a command; `null` means it succeeded. */
export type CommandError = { code: ErrorCode; message: string } | null;

export interface RoomCallbacks {
  /** State changed in a way clients must see. */
  onChange(room: Room): void;
  /** The host device should speak this line. */
  onNarrate(room: Room, key: string, params?: Record<string, string | number>): void;
}

const log = createLogger("room");

function ok(): CommandError {
  return null;
}

function fail(code: ErrorCode, message: string): CommandError {
  return { code, message };
}

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();

  /** Seat order: join order, and the order every client renders the table in. */
  private readonly seats: Player[] = [];

  private hostIdValue: PlayerId | null = null;

  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  deck: RoleId[] = [];
  phase: Phase = "lobby";
  round = 0;

  night: NightState | null = null;
  votes = new Map<PlayerId, PlayerId>();
  result: RoundResult | null = null;

  /** Current deadline, mirrored to clients as a countdown. */
  deadline: { endsAt: number; durationMs: number } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    code: string,
    private readonly callbacks: RoomCallbacks,
  ) {
    this.code = code;
  }

  /* ---------------------------------------------------------------------- */
  /* Accessors                                                              */
  /* ---------------------------------------------------------------------- */

  get players(): readonly Player[] {
    return this.seats;
  }

  get hostId(): PlayerId | null {
    return this.hostIdValue;
  }

  get playerCount(): number {
    return this.seats.length;
  }

  get isIdle(): boolean {
    return this.seats.every((player) => !player.connected);
  }

  /** Epoch ms since the last connected player left, or null if someone is in. */
  get idleSince(): number | null {
    if (!this.isIdle) return null;
    const stamps = this.seats.map((player) => player.disconnectedAt ?? this.createdAt);
    return stamps.length === 0 ? this.createdAt : Math.max(...stamps);
  }

  getPlayer(playerId: PlayerId): Player | undefined {
    return this.seats.find((player) => player.id === playerId);
  }

  isHost(playerId: PlayerId): boolean {
    return this.hostIdValue === playerId;
  }

  /** How many seats `deviceId` currently holds. */
  seatsOnDevice(deviceId: string): number {
    return this.seats.reduce((total, player) => total + (player.deviceId === deviceId ? 1 : 0), 0);
  }

  /**
   * Seats held by the most crowded device, at least 1.
   *
   * The role reveal is scaled by this: on a shared phone the players look at
   * their cards one after the other, so a single share of the configured time
   * would leave the second one staring at a gate that is about to expire.
   */
  maxSeatsPerDevice(): number {
    const perDevice = new Map<string, number>();
    for (const player of this.seats) {
      perDevice.set(player.deviceId, (perDevice.get(player.deviceId) ?? 0) + 1);
    }
    return Math.max(1, ...perDevice.values());
  }

  get inGame(): boolean {
    return this.phase !== "lobby";
  }

  /* ---------------------------------------------------------------------- */
  /* Seating                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Seats a new player on `deviceId`. Returns the created seat, or an error
   * when the room is full, the device already holds its share of seats, or a
   * round is already running.
   */
  join(nickname: string, deviceId: string): { player: Player } | { error: CommandError } {
    if (this.inGame) {
      return { error: fail("game_in_progress", "A round is already running in this room.") };
    }
    if (this.seats.length >= maxSupportedPlayers()) {
      return { error: fail("room_full", "This room is full.") };
    }
    if (this.seatsOnDevice(deviceId) >= MAX_SEATS_PER_DEVICE) {
      return { error: fail("device_full", "This device already holds its share of seats.") };
    }

    const player: Player = {
      id: newPlayerId(),
      token: newToken(),
      nickname: this.uniqueNickname(sanitizeNickname(nickname)),
      deviceId,
      connected: false,
      disconnectedAt: Date.now(),
      ready: false,
    };
    this.seats.push(player);
    if (this.hostIdValue === null) this.hostIdValue = player.id;

    // Keep the deck sensible as the table grows, unless the host has already
    // hand-tuned it into something still valid.
    this.autoFitDeck();
    this.callbacks.onChange(this);
    return { player };
  }

  /** Verifies resume credentials and marks the seat online. */
  resume(playerId: PlayerId, token: string): Player | null {
    const player = this.getPlayer(playerId);
    if (!player || player.token !== token) return null;
    this.setConnected(player, true);
    return player;
  }

  setConnected(player: Player, connected: boolean): void {
    if (player.connected === connected) return;
    player.connected = connected;
    player.disconnectedAt = connected ? null : Date.now();

    // A vote can only be waited on by connected players, so a drop may be the
    // event that completes the round.
    if (this.phase === "vote") this.maybeFinishVote();
    this.callbacks.onChange(this);
  }

  /**
   * Removes a seat entirely. Only meaningful in the lobby - mid-round a player
   * keeps their card and simply shows as disconnected, because removing them
   * would invalidate the deck everyone else is reasoning about.
   */
  removePlayer(playerId: PlayerId): void {
    const index = this.seats.findIndex((player) => player.id === playerId);
    if (index === -1) return;
    this.seats.splice(index, 1);
    if (this.hostIdValue === playerId) this.hostIdValue = this.seats[0]?.id ?? null;
    this.autoFitDeck();
    this.callbacks.onChange(this);
  }

  /**
   * Hands the host role to the first connected player. Called by the manager
   * once the current host has been offline past the grace period, so a table
   * is never left without a narrator device.
   */
  reassignHostIfNeeded(graceMs: number): boolean {
    const host = this.hostIdValue ? this.getPlayer(this.hostIdValue) : undefined;
    if (host?.connected) return false;

    const offlineSince = host?.disconnectedAt ?? this.createdAt;
    if (Date.now() - offlineSince < graceMs) return false;

    const successor = this.seats.find((player) => player.connected);
    if (!successor || successor.id === this.hostIdValue) return false;

    log.info(`${this.code}: host moved to ${successor.nickname}`);
    this.hostIdValue = successor.id;
    this.callbacks.onChange(this);
    return true;
  }

  setNickname(playerId: PlayerId, nickname: string): CommandError {
    const player = this.getPlayer(playerId);
    if (!player) return fail("not_in_room", "You are not seated in this room.");
    player.nickname = this.uniqueNickname(sanitizeNickname(nickname), player.id);
    this.callbacks.onChange(this);
    return ok();
  }

  private uniqueNickname(base: string, ignoreId?: PlayerId): string {
    const taken = new Set(
      this.seats.filter((player) => player.id !== ignoreId).map((player) => player.nickname.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  /* ---------------------------------------------------------------------- */
  /* Lobby configuration                                                    */
  /* ---------------------------------------------------------------------- */

  setDeck(playerId: PlayerId, counts: DeckCounts): CommandError {
    const guard = this.requireHostInLobby(playerId);
    if (guard) return guard;
    this.deck = countsToDeck(counts);
    this.callbacks.onChange(this);
    return ok();
  }

  setSettings(playerId: PlayerId, patch: Partial<RoomSettings>): CommandError {
    const guard = this.requireHostInLobby(playerId);
    if (guard) return guard;

    for (const key of NUMERIC_SETTING_KEYS) {
      const value = patch[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const bounds = SETTINGS_BOUNDS[key];
      this.settings[key] = Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
    }
    if (typeof patch.narrationEnabled === "boolean") {
      this.settings.narrationEnabled = patch.narrationEnabled;
    }

    this.callbacks.onChange(this);
    return ok();
  }

  /**
   * Replaces the deck with a default one whenever the current deck no longer
   * fits the table. Hand-tuned but still-valid decks are left alone.
   */
  private autoFitDeck(): void {
    if (this.seats.length < MIN_PLAYERS) {
      // Below the minimum there is no valid deck; show the host a plausible one.
      this.deck = suggestDeck(Math.max(this.seats.length, MIN_PLAYERS));
      return;
    }
    if (validateDeck(this.deck, this.seats.length).ok) return;
    this.deck = suggestDeck(this.seats.length);
  }

  private requireHostInLobby(playerId: PlayerId): CommandError {
    if (!this.isHost(playerId)) return fail("not_host", "Only the host can change this.");
    if (this.inGame) return fail("game_in_progress", "The round has already started.");
    return ok();
  }

  /* ---------------------------------------------------------------------- */
  /* Phase machine                                                          */
  /* ---------------------------------------------------------------------- */

  startGame(playerId: PlayerId): CommandError {
    const guard = this.requireHostInLobby(playerId);
    if (guard) return guard;

    const validation = validateDeck(this.deck, this.seats.length);
    if (!validation.ok) {
      return fail("invalid_deck", `Deck is not playable: ${validation.reason}`);
    }

    const seatIds = this.seats.map((player) => player.id);
    const { dealt, center } = dealCards(this.deck, seatIds);
    this.night = createNightState(dealt, center, wakeOrderForDeck(this.deck));
    this.votes.clear();
    this.result = null;
    for (const player of this.seats) player.ready = false;

    log.info(`${this.code}: round ${this.round + 1} dealt to ${seatIds.length} players`);
    const revealSeconds = this.settings.roleRevealSeconds * this.maxSeatsPerDevice();
    this.enterPhase("role_reveal", revealSeconds * 1000, () => this.beginNight());
    this.narrate("phase.roleReveal", { seconds: revealSeconds });
    return ok();
  }

  /** Acknowledges the role reveal. The phase ends early once everyone has. */
  markReady(playerId: PlayerId): CommandError {
    if (this.phase !== "role_reveal") return fail("invalid_action", "Not in the reveal phase.");
    const player = this.getPlayer(playerId);
    if (!player) return fail("not_in_room", "You are not seated in this room.");
    if (player.ready) return ok();

    player.ready = true;
    const waitingOn = this.seats.filter((seat) => seat.connected && !seat.ready);
    if (waitingOn.length === 0) {
      this.beginNight();
    } else {
      this.callbacks.onChange(this);
    }
    return ok();
  }

  /**
   * Nightfall, which opens on a pause rather than on the first role.
   *
   * The reveal can end early - the moment the last player taps "ready" - so
   * the others may still have a phone in hand. Nobody is called until the
   * table has had `NIGHT_SETTLE_SECONDS` to put the screens down, and no turn
   * is handed out meanwhile.
   */
  private beginNight(): void {
    const night = this.night;
    if (!night) return;
    night.stepIndex = 0;
    night.settling = true;
    this.narrate("phase.night");
    this.enterPhase("night", NIGHT_SETTLE_SECONDS * 1000, () => {
      night.settling = false;
      this.runNightStep();
    });
  }

  /**
   * Opens the current night step.
   *
   * Every role in the *deck* gets a step, even one that was dealt to the
   * center and therefore belongs to nobody. Skipping it would let the table
   * infer the center's contents from the narrator's silence.
   */
  private runNightStep(): void {
    const night = this.night;
    if (!night) return;

    // Not `currentRole`: that one reports nobody during the settling pause,
    // which here would be read as the end of the night.
    const role = scriptedRole(night);
    if (!role) {
      this.beginDay();
      return;
    }

    // Roles that act without choosing anything - the Insomniac looking at
    // their own card - fire here, before the snapshot that opens the step is
    // sent, so the result is on screen for the whole of it.
    const onTurnStart = TURN_START_HANDLERS[role];
    if (onTurnStart) {
      const seatIds = this.seats.map((player) => player.id);
      for (const holder of holdersOf(night, role, seatIds)) {
        const turn = getTurnState(night, holder);
        onTurnStart({ night, actorId: holder, fellows: [], turn });
        turn.resolved = true;
      }
    }

    this.narrate(`wake.${role}`);
    this.enterPhase("night", this.settings.nightStepSeconds * 1000, () => {
      this.narrate(`sleep.${role}`);
      night.stepIndex += 1;
      this.runNightStep();
    });
  }

  private beginDay(): void {
    this.narrate("phase.day", { seconds: this.settings.discussionSeconds });
    this.enterPhase("day", this.settings.discussionSeconds * 1000, () => this.beginVote());
  }

  endDiscussion(playerId: PlayerId): CommandError {
    if (!this.isHost(playerId)) return fail("not_host", "Only the host can end the discussion.");
    if (this.phase !== "day") return fail("invalid_action", "Discussion is not running.");
    this.beginVote();
    return ok();
  }

  private beginVote(): void {
    this.votes.clear();
    this.narrate("phase.vote");
    this.enterPhase("vote", this.settings.voteSeconds * 1000, () => this.finishRound());
  }

  castVote(playerId: PlayerId, targetId: PlayerId): CommandError {
    if (this.phase !== "vote") return fail("invalid_action", "Voting is not open.");
    if (!this.getPlayer(playerId)) return fail("not_in_room", "You are not seated in this room.");
    if (!this.getPlayer(targetId)) return fail("bad_request", "Unknown vote target.");
    if (targetId === playerId) return fail("invalid_action", "You cannot vote for yourself.");

    this.votes.set(playerId, targetId);
    if (!this.maybeFinishVote()) this.callbacks.onChange(this);
    return ok();
  }

  /** Ends the vote as soon as every connected player has pointed at someone. */
  private maybeFinishVote(): boolean {
    if (this.phase !== "vote") return false;
    const pending = this.seats.filter((player) => player.connected && !this.votes.has(player.id));
    if (pending.length > 0) return false;
    this.finishRound();
    return true;
  }

  private finishRound(): void {
    const night = this.night;
    if (!night) return;

    const seatIds = this.seats.map((player) => player.id);
    const { tally, eliminated, noOneDied } = countVotes(this.votes, seatIds);

    // The vote elects the victims; a Hunter among them then takes their own
    // target down before the round is judged.
    const hunted = applyHunterShots(eliminated, this.votes, night.playerCards);
    const dead = [...eliminated, ...hunted];
    const outcome = decideOutcome(night.playerCards, dead);

    this.result = {
      outcome,
      finalRoles: Object.fromEntries(night.playerCards),
      dealtRoles: Object.fromEntries(night.dealt),
      centerRoles: night.center.slice(),
      votes: Object.fromEntries(this.votes),
      tally,
      eliminated: dead,
      hunted,
      noOneDied,
    };

    log.info(`${this.code}: round ended, outcome=${outcome}`);
    this.narrate(`outcome.${outcome}`);
    this.enterPhase("reveal", null, null);
  }

  /**
   * The host's emergency stop, offered during the night alone.
   *
   * The night is the one phase the table cannot repair by talking: every
   * player but the called role has their eyes shut, so only the narrator can
   * see that a phone has died mid-turn, that the wrong role answered, or that
   * somebody walked in. This abandons the round rather than trying to rewind
   * it - cards already looked at cannot be unlooked, so the only honest
   * recovery is a fresh deal.
   */
  stopRound(playerId: PlayerId): CommandError {
    if (!this.isHost(playerId)) return fail("not_host", "Only the host can stop the round.");
    if (this.phase !== "night") return fail("invalid_action", "The night is not running.");

    log.info(`${this.code}: round ${this.round + 1} stopped by the host`);
    // Spoken before the phase changes, because the table is sitting in the
    // dark waiting for the next role: somebody has to tell them to look up.
    this.narrate("phase.stopped");
    this.resetToLobby();
    return ok();
  }

  playAgain(playerId: PlayerId): CommandError {
    if (!this.isHost(playerId)) return fail("not_host", "Only the host can restart.");
    if (this.phase !== "reveal") return fail("invalid_action", "The round is not over yet.");

    this.resetToLobby();
    return ok();
  }

  /**
   * Drops the round in progress and reopens the lobby, keeping the table, the
   * deck and the settings. Reached both from a round played to its end and
   * from one the host stopped part-way; neither leaves anything to resume.
   */
  private resetToLobby(): void {
    this.round += 1;
    this.night = null;
    this.result = null;
    this.votes.clear();
    for (const player of this.seats) player.ready = false;
    this.autoFitDeck();
    this.enterPhase("lobby", null, null);
  }

  /* ---------------------------------------------------------------------- */
  /* Night actions                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies a night action for `playerId`.
   *
   * Guards, in order: the night is running, this player was *dealt* the role
   * being called, they have not already acted, and the selection satisfies one
   * of the role's declared groups. Only then does the role handler run.
   */
  performNightAction(playerId: PlayerId, groupId: string, slots: unknown): CommandError {
    const night = this.night;
    if (this.phase !== "night" || !night) return fail("invalid_action", "The night is not running.");

    const role = currentRole(night);
    if (!role) return fail("invalid_action", "No role is being called.");
    if (night.dealt.get(playerId) !== role) {
      return fail("invalid_action", "It is not your turn.");
    }

    const turn = getTurnState(night, playerId);
    if (turn.resolved) return fail("invalid_action", "You have already acted this turn.");

    if (!Array.isArray(slots)) return fail("bad_request", "Malformed selection.");
    const knownPlayers = new Set(this.seats.map((player) => player.id));
    if (!slots.every((slot) => isValidSlot(slot, knownPlayers))) {
      return fail("bad_request", "Malformed selection.");
    }
    const typedSlots = slots as CardSlot[];

    const fellows = this.fellowsOf(playerId);
    const groups = getRole(role).selection({ holderCount: this.holderCountOf(role) });

    const problem = validateSelection(role, groups, groupId, typedSlots, playerId);
    if (problem) return fail("invalid_action", `Illegal selection: ${problem}`);

    ROLE_HANDLERS[role]({ night, actorId: playerId, fellows, turn }, groupId, typedSlots);
    turn.resolved = true;

    this.callbacks.onChange(this);
    return ok();
  }

  /** Declines to act. Every night action in the base game is optional. */
  skipNightAction(playerId: PlayerId): CommandError {
    const night = this.night;
    if (this.phase !== "night" || !night) return fail("invalid_action", "The night is not running.");

    const role = currentRole(night);
    if (!role || night.dealt.get(playerId) !== role) {
      return fail("invalid_action", "It is not your turn.");
    }

    const turn = getTurnState(night, playerId);
    if (turn.resolved) return ok();
    turn.resolved = true;
    this.callbacks.onChange(this);
    return ok();
  }

  /* ---------------------------------------------------------------------- */
  /* Timers                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * The single entry point for phase changes. Pass `durationMs = null` for a
   * phase that waits on players rather than on the clock.
   */
  private enterPhase(phase: Phase, durationMs: number | null, onExpire: (() => void) | null): void {
    this.clearTimer();
    this.phase = phase;

    if (durationMs !== null && onExpire) {
      this.deadline = { endsAt: Date.now() + durationMs, durationMs };
      this.timer = setTimeout(() => {
        this.timer = null;
        this.deadline = null;
        try {
          onExpire();
        } catch (error) {
          log.error(`${this.code}: phase timer failed`, error);
        }
      }, durationMs);
    } else {
      this.deadline = null;
    }

    this.callbacks.onChange(this);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  private narrate(key: string, params?: Record<string, string | number>): void {
    if (!this.settings.narrationEnabled) return;
    this.callbacks.onNarrate(this, key, params);
  }

  /** Releases the room's timer. Called by the manager before dropping it. */
  dispose(): void {
    this.clearTimer();
  }

  /* ---------------------------------------------------------------------- */
  /* Derived helpers used by the view builder                               */
  /* ---------------------------------------------------------------------- */

  /** Role being called right now, or null outside the night. */
  currentNightRole(): RoleId | null {
    if (this.phase !== "night" || !this.night) return null;
    return currentRole(this.night) ?? null;
  }

  /**
   * Players whose cards are turned face up for `playerId` during their own
   * step, in seat order.
   *
   * Usually the other holders of their own role - werewolves and Masons
   * recognising each other - but not necessarily: the Minion is shown the
   * werewolves, who are never shown the Minion. Which is which is declared by
   * `sees` in the role registry.
   */
  fellowsOf(playerId: PlayerId): PlayerId[] {
    const night = this.night;
    if (!night) return [];
    const role = night.dealt.get(playerId);
    if (!role) return [];
    const seen = ROLES[role].sees;
    if (!seen) return [];
    const seatIds = this.seats.map((player) => player.id);
    return holdersOf(night, seen, seatIds).filter((id) => id !== playerId);
  }

  /**
   * How many seats were dealt `role` tonight.
   *
   * Feeds `SelectionContext.holderCount`, which is what tells a lone werewolf
   * from a pack. Counted from the deal rather than from `fellowsOf`, since the
   * two only coincide for roles that recognise their own kind.
   */
  holderCountOf(role: RoleId): number {
    const night = this.night;
    if (!night) return 0;
    const seatIds = this.seats.map((player) => player.id);
    return holdersOf(night, role, seatIds).length;
  }
}

function sanitizeNickname(raw: string): string {
  const collapsed = String(raw ?? "").replace(/\s+/g, " ");
  // Drop control characters so a nickname can never break another device's
  // layout or smuggle terminal escapes into a log line.
  const printable = Array.from(collapsed)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join("");
  const trimmed = printable.trim().slice(0, NICKNAME_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : "Joueur";
}
