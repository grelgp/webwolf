/**
 * The role registry.
 *
 * Everything the *rules* need to know about a role that both sides of the wire
 * must agree on lives here: which team it belongs to, how many copies exist in
 * the box, when it wakes at night, and what its player is allowed to click.
 *
 * What a role actually *does* when it acts lives server-side in
 * `src/server/game/roleHandlers.ts` — it needs access to the mutable night
 * state, which the client must never see. Adding a role therefore means
 * touching this file, that file, and the French copy in
 * `src/client/i18n/fr.ts`. See `docs/adding-a-role.md`.
 */

import { CENTER_CARD_COUNT, MAX_PLAYERS } from "./constants.js";

export type RoleId = "werewolf" | "villager" | "seer" | "robber" | "troublemaker";

export type Team = "village" | "werewolf";

/**
 * One card position on the table. Night actions target these rather than
 * players directly, because the three center cards are targetable too.
 */
export type CardSlot =
  | { kind: "player"; playerId: string }
  | { kind: "center"; index: number };

/**
 * One way a role is allowed to fill its night action.
 *
 * A role offers a list of groups and the player satisfies *exactly one* of
 * them. That single primitive covers every base-game role:
 *
 * - Robber        -> one group: 1 player, not self
 * - Troublemaker  -> one group: 2 players, not self
 * - Lone Werewolf -> one group: 1 center card
 * - Seer          -> two groups: (1 player, not self) OR (2 center cards)
 *
 * The client drives its whole selection UI from this description, so a new
 * role usually needs no new client code at all.
 */
export interface SelectionGroup {
  /** Stable identifier, echoed back by the client with the chosen slots. */
  id: string;
  source: "players" | "center";
  /** Exact number of slots the player must pick to satisfy this group. */
  count: number;
  /** When true the acting player cannot target their own seat. */
  excludeSelf: boolean;
}

/**
 * Context handed to `selection()` so a role can offer different choices
 * depending on the table. Currently only the lone-werewolf rule needs it.
 */
export interface SelectionContext {
  /** How many players hold this same role tonight (including the actor). */
  holderCount: number;
}

export interface RoleDefinition {
  id: RoleId;
  team: Team;
  /** Copies of this card in the physical box; the deck builder enforces it. */
  maxCopies: number;
  /**
   * Position in the narrator's wake order, lower wakes first. `null` means the
   * role never wakes (Villager) and therefore gets no night step.
   *
   * Values follow the official order and are spaced by 10 so future roles
   * (Doppelganger 5, Minion 15, Masons 18, Drunk 45, Insomniac 50...) slot in
   * without renumbering anything.
   */
  wakeOrder: number | null;
  /**
   * When true, everyone holding this role is shown to the others at the start
   * of the step (Werewolves recognising each other; later, the Masons).
   */
  seesFellows: boolean;
  /** What this role may click during its step. Empty array = nothing to do. */
  selection: (context: SelectionContext) => SelectionGroup[];
}

const CENTER_INDEXES = Array.from({ length: CENTER_CARD_COUNT }, (_, i) => i);

/** Every role the game knows about, keyed by id. */
export const ROLES: Record<RoleId, RoleDefinition> = {
  werewolf: {
    id: "werewolf",
    team: "werewolf",
    maxCopies: 2,
    wakeOrder: 10,
    seesFellows: true,
    selection: ({ holderCount }) =>
      // A lone werewolf has nobody to recognise, so the rules let them peek at
      // one center card instead. With two or more wolves there is no choice.
      holderCount === 1 ? [{ id: "peek", source: "center", count: 1, excludeSelf: false }] : [],
  },

  seer: {
    id: "seer",
    team: "village",
    maxCopies: 1,
    wakeOrder: 20,
    seesFellows: false,
    selection: () => [
      { id: "player", source: "players", count: 1, excludeSelf: true },
      { id: "center", source: "center", count: 2, excludeSelf: false },
    ],
  },

  robber: {
    id: "robber",
    team: "village",
    maxCopies: 1,
    wakeOrder: 30,
    seesFellows: false,
    selection: () => [{ id: "steal", source: "players", count: 1, excludeSelf: true }],
  },

  troublemaker: {
    id: "troublemaker",
    team: "village",
    maxCopies: 1,
    wakeOrder: 40,
    seesFellows: false,
    selection: () => [{ id: "swap", source: "players", count: 2, excludeSelf: true }],
  },

  villager: {
    id: "villager",
    team: "village",
    maxCopies: 3,
    wakeOrder: null,
    seesFellows: false,
    selection: () => [],
  },
};

/** Deck-builder display order (also the lobby row order in the UI). */
export const ROLE_ORDER: RoleId[] = ["werewolf", "seer", "robber", "troublemaker", "villager"];

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && value in ROLES;
}

export function getRole(id: RoleId): RoleDefinition {
  return ROLES[id];
}

/**
 * Largest deck the current role set can build, and therefore the largest table
 * this build supports (deck size is always players + 3).
 */
export const MAX_DECK_SIZE = ROLE_ORDER.reduce((total, id) => total + ROLES[id].maxCopies, 0);

/**
 * Largest table this build can seat.
 *
 * The deck always holds players + 3 cards, so the number of cards in the box
 * caps the table. Raising it is a matter of registering more roles, not of
 * changing this formula.
 */
export function maxSupportedPlayers(): number {
  return Math.min(MAX_PLAYERS, MAX_DECK_SIZE - CENTER_CARD_COUNT);
}

/**
 * Roles present in `deck`, in narrator wake order.
 *
 * Note this is derived from the *deck*, not from who was dealt what: a role
 * sitting in the center is still called out loud, otherwise the silence would
 * tell everyone it is not in play. See `docs/architecture.md`.
 */
export function wakeOrderForDeck(deck: RoleId[]): RoleId[] {
  const present = new Set(deck);
  return ROLE_ORDER.filter((id) => present.has(id) && ROLES[id].wakeOrder !== null).sort(
    (a, b) => (ROLES[a].wakeOrder ?? 0) - (ROLES[b].wakeOrder ?? 0),
  );
}

/** Every center slot index, for building selection grids. */
export function centerIndexes(): number[] {
  return CENTER_INDEXES;
}

export function slotKey(slot: CardSlot): string {
  return slot.kind === "player" ? `p:${slot.playerId}` : `c:${slot.index}`;
}

export function sameSlot(a: CardSlot, b: CardSlot): boolean {
  return slotKey(a) === slotKey(b);
}
