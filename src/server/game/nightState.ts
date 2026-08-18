/**
 * Mutable state of one night.
 *
 * The single most important invariant in this file:
 *
 *   `dealt` never changes; `playerCards` and `center` do.
 *
 * Who wakes up is decided by `dealt` - you act as the card you were handed,
 * even if the Robber has since taken it. What you *are* at dawn is decided by
 * `playerCards`. Because the night steps run strictly one after another and
 * each one mutates in place, ordering falls out for free: the Seer looking at
 * a player before the Robber's turn genuinely sees the pre-theft card.
 */

import { CENTER_CARD_COUNT } from "../../shared/constants.js";
import { sameSlot, slotKey, type CardSlot, type RoleId } from "../../shared/roles.js";
import type { PlayerId, RevealedCard } from "../../shared/protocol.js";

/** Per-player, per-step record of what happened on their turn. */
export interface TurnState {
  /** The player has acted or explicitly skipped; no further action allowed. */
  resolved: boolean;
  /** Card faces shown to this player only. */
  revealed: RevealedCard[];
  /** Slots this player moved, so the UI can confirm a blind swap happened. */
  swapped: CardSlot[];
}

export function emptyTurnState(): TurnState {
  return { resolved: false, revealed: [], swapped: [] };
}

export interface NightState {
  /** Card originally dealt to each player. Drives who wakes. Immutable. */
  readonly dealt: ReadonlyMap<PlayerId, RoleId>;
  /** Card currently in front of each player. Mutated by swaps. */
  playerCards: Map<PlayerId, RoleId>;
  /** Current contents of the three center slots. Mutated by swaps. */
  center: RoleId[];
  /** Roles the narrator calls tonight, in wake order. Derived from the deck. */
  readonly script: readonly RoleId[];
  /** Index into `script` of the step currently running. */
  stepIndex: number;
  /**
   * True from nightfall until the first role is called. It exists so no turn
   * is handed out during the pause, without having to teach every caller of
   * `currentRole` about it.
   */
  settling: boolean;
  /** Keyed by `stepIndex:playerId`. */
  turns: Map<string, TurnState>;
}

export function createNightState(
  dealt: Map<PlayerId, RoleId>,
  center: RoleId[],
  script: readonly RoleId[],
): NightState {
  return {
    dealt: new Map(dealt),
    playerCards: new Map(dealt),
    center: center.slice(),
    script,
    stepIndex: 0,
    settling: false,
    turns: new Map(),
  };
}

export function turnKey(stepIndex: number, playerId: PlayerId): string {
  return `${stepIndex}:${playerId}`;
}

export function getTurnState(night: NightState, playerId: PlayerId): TurnState {
  const key = turnKey(night.stepIndex, playerId);
  let state = night.turns.get(key);
  if (!state) {
    state = emptyTurnState();
    night.turns.set(key, state);
  }
  return state;
}

/**
 * The role being called right now, or `undefined` when nobody is: during the
 * settling pause that opens the night, and once the script has run out.
 *
 * Everything that hands out a turn or accepts a night action goes through
 * here, so the pause closes all of them at once.
 */
export function currentRole(night: NightState): RoleId | undefined {
  return night.settling ? undefined : night.script[night.stepIndex];
}

/**
 * The role at the current step, pause or no pause. Only the scheduler wants
 * this: it needs to tell "not yet" from "the night is over".
 */
export function scriptedRole(night: NightState): RoleId | undefined {
  return night.script[night.stepIndex];
}

/** Players whose *dealt* card is `role`, in seat order. */
export function holdersOf(
  night: NightState,
  role: RoleId,
  seatOrder: readonly PlayerId[],
): PlayerId[] {
  return seatOrder.filter((id) => night.dealt.get(id) === role);
}

/* -------------------------------------------------------------------------- */
/* Slot access                                                                */
/* -------------------------------------------------------------------------- */

export function readSlot(night: NightState, slot: CardSlot): RoleId | undefined {
  return slot.kind === "player" ? night.playerCards.get(slot.playerId) : night.center[slot.index];
}

function writeSlot(night: NightState, slot: CardSlot, role: RoleId): void {
  if (slot.kind === "player") {
    night.playerCards.set(slot.playerId, role);
  } else {
    night.center[slot.index] = role;
  }
}

/**
 * Exchanges the cards in two slots. Returns false when either slot is empty,
 * which can only happen if a player left mid-night.
 */
export function swapSlots(night: NightState, a: CardSlot, b: CardSlot): boolean {
  if (sameSlot(a, b)) return false;
  const cardA = readSlot(night, a);
  const cardB = readSlot(night, b);
  if (cardA === undefined || cardB === undefined) return false;
  writeSlot(night, a, cardB);
  writeSlot(night, b, cardA);
  return true;
}

export function isValidSlot(slot: unknown, knownPlayers: ReadonlySet<PlayerId>): slot is CardSlot {
  if (typeof slot !== "object" || slot === null) return false;
  const candidate = slot as { kind?: unknown; playerId?: unknown; index?: unknown };
  if (candidate.kind === "player") {
    return typeof candidate.playerId === "string" && knownPlayers.has(candidate.playerId);
  }
  if (candidate.kind === "center") {
    return (
      typeof candidate.index === "number" &&
      Number.isInteger(candidate.index) &&
      candidate.index >= 0 &&
      candidate.index < CENTER_CARD_COUNT
    );
  }
  return false;
}

export function uniqueSlots(slots: readonly CardSlot[]): boolean {
  return new Set(slots.map(slotKey)).size === slots.length;
}
