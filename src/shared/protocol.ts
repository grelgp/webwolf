/**
 * The WebSocket wire format.
 *
 * Design notes
 * ------------
 * 1. The server never sends deltas. Every change re-sends a full, *per-player
 *    redacted* snapshot (`ServerMessage["state"]`). Tables are at most ten
 *    players, so a snapshot is a couple of kilobytes, and in exchange
 *    reconnection, late joins and "what may this player legally see" all
 *    collapse into one code path (`src/server/net/views.ts`).
 *
 * 2. The server sends *semantic* data only - role ids, slot references,
 *    narration keys. All French copy lives in `src/client/i18n/fr.ts`. That
 *    keeps the rules engine language-free and leaves room for other locales.
 *
 * 3. Secrets are omitted from the snapshot, never merely flagged. A player who
 *    is not the Seer receives no field describing what the Seer saw, so there
 *    is nothing to dig out of devtools.
 */

import type { RoomSettings } from "./constants.js";
import type { CardSlot, RoleId, SelectionGroup } from "./roles.js";

export type PlayerId = string;

export type Phase = "lobby" | "role_reveal" | "night" | "day" | "vote" | "reveal";

/* -------------------------------------------------------------------------- */
/* Client -> Server                                                           */
/* -------------------------------------------------------------------------- */

export type ClientMessage =
  /** First frame on every socket. Carries resume credentials when we have them. */
  | { t: "hello"; protocol: number; code?: string; playerId?: PlayerId; token?: string }
  | { t: "create_room"; nickname: string }
  | { t: "join_room"; code: string; nickname: string }
  | { t: "leave_room" }
  | { t: "set_nickname"; nickname: string }
  /** Host only. Absolute card counts per role, e.g. `{ werewolf: 2, seer: 1 }`. */
  | { t: "set_deck"; deck: Partial<Record<RoleId, number>> }
  /** Host only. Partial patch; unknown keys are ignored, numbers are clamped. */
  | { t: "set_settings"; settings: Partial<RoomSettings> }
  | { t: "kick_player"; playerId: PlayerId }
  | { t: "start_game" }
  /** Acknowledges the role reveal; the phase ends early once everyone has. */
  | { t: "ready" }
  /** Night action. `groupId` names the `SelectionGroup` being satisfied. */
  | { t: "night_action"; groupId: string; slots: CardSlot[] }
  /** Explicitly decline to act this turn (every night action is optional). */
  | { t: "night_skip" }
  /** Host only. Ends the discussion timer early. */
  | { t: "end_discussion" }
  | { t: "cast_vote"; targetId: PlayerId }
  /** Host only. Returns the room to the lobby, keeping players and settings. */
  | { t: "play_again" }
  | { t: "ping" };

/* -------------------------------------------------------------------------- */
/* Server -> Client                                                           */
/* -------------------------------------------------------------------------- */

export type ErrorCode =
  | "bad_protocol"
  | "bad_request"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_host"
  | "not_in_room"
  | "invalid_deck"
  | "invalid_action"
  | "kicked"
  | "internal";

export type ServerMessage =
  /** Sent once a socket is attached to a seat. Credentials go to localStorage. */
  | { t: "welcome"; playerId: PlayerId; token: string; code: string }
  | { t: "state"; state: ClientState }
  /**
   * Speaker cue, sent to the host device only. `key` indexes the narration
   * table in `src/client/i18n/fr.ts`.
   */
  | { t: "narrate"; key: string; params?: Record<string, string | number> }
  | { t: "error"; code: ErrorCode; message: string }
  /** Confirms the socket is unbound, e.g. after leaving or being kicked. */
  | { t: "goodbye"; reason: ErrorCode | "left" }
  | { t: "pong" };

/* -------------------------------------------------------------------------- */
/* Redacted snapshot                                                          */
/* -------------------------------------------------------------------------- */

/** What every player may know about every other player, in every phase. */
export interface PublicPlayer {
  id: PlayerId;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  /**
   * Set during `role_reveal` only. Deliberately absent during `night`: knowing
   * who has already acted would leak who holds the role being called.
   */
  ready?: boolean;
  /** Set during `vote` only, and only as a boolean - never the target. */
  hasVoted?: boolean;
}

/** A server-authoritative countdown. Clients render it against `serverNow`. */
export interface TimerView {
  /** Epoch milliseconds, on the server clock. */
  endsAt: number;
  durationMs: number;
}

export interface NightView {
  /** 1-based, for the "step 2 / 4" indicator. */
  step: number;
  stepCount: number;
  /** The role the narrator is calling right now. Public: it is said out loud. */
  role: RoleId;
}

/** A card whose face has been shown to *this* player, and to nobody else. */
export interface RevealedCard {
  slot: CardSlot;
  role: RoleId;
}

/**
 * What the acting player sees during their own night step.
 *
 * Present only in the snapshot of a player whose dealt role is the one being
 * called, and only for the duration of that step.
 */
export interface NightTurnView {
  /** The dealt role this player is acting as. */
  role: RoleId;
  /** Choices still open. Empty once the action is resolved. */
  groups: SelectionGroup[];
  /** Other holders of the same role, e.g. fellow werewolves. */
  fellows: PlayerId[];
  /** Faces shown to this player as a result of their action. */
  revealed: RevealedCard[];
  /** Slots this player caused to change hands, for a "swap done" confirmation. */
  swapped: CardSlot[];
  /** True once the player has acted or skipped; the UI then just waits. */
  resolved: boolean;
  /** True when the role had no choice to make at all (e.g. a pack of wolves). */
  passive: boolean;
}

/** Private payload. Only ever populated for the player it belongs to. */
export interface PrivateView {
  /** The card this player was dealt. Shown during `role_reveal` only. */
  dealtRole?: RoleId;
  /** This player's turn, during `night` only. */
  turn?: NightTurnView;
  /** The vote this player cast, during `vote` only. */
  vote?: PlayerId;
}

export type RoundOutcome = "village" | "werewolf" | "nobody";

/** Full disclosure, sent to everyone once the round is over. */
export interface RoundResult {
  outcome: RoundOutcome;
  /** Final card of each player, after every night swap. */
  finalRoles: Record<PlayerId, RoleId>;
  /** Card each player was originally dealt. */
  dealtRoles: Record<PlayerId, RoleId>;
  /** Final contents of the three center cards. */
  centerRoles: RoleId[];
  /** voterId -> targetId. Players who never voted are absent. */
  votes: Record<PlayerId, PlayerId>;
  /** Vote count per player, including players who received none. */
  tally: Record<PlayerId, number>;
  eliminated: PlayerId[];
  /** True when the "everyone got exactly one vote" rule spared the table. */
  noOneDied: boolean;
}

export interface ClientState {
  code: string;
  phase: Phase;
  /** Increments on every "play again"; used to reset per-round client UI. */
  round: number;
  /** Server clock at send time, so the client can offset its countdowns. */
  serverNow: number;
  /** The receiving player's own id - the key into `players`. */
  youId: PlayerId;
  isHost: boolean;
  players: PublicPlayer[];
  settings: RoomSettings;
  /** Cards chosen for this round. Public knowledge, exactly as in the box. */
  deck: RoleId[];
  timer?: TimerView;
  night?: NightView;
  private?: PrivateView;
  /** During `vote`: how many players have locked in. Never who they picked. */
  voteProgress?: { voted: number; total: number };
  result?: RoundResult;
}
