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

export type RoleId =
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "hunter"
  | "villager"
  | "tanner";

/**
 * Who a card wins with.
 *
 * The Tanner is a team of one: they win by dying, and take the win away from
 * everyone else when they do. See `src/server/game/resolution.ts`.
 */
export type Team = "village" | "werewolf" | "tanner";

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
  /**
   * How many players were *dealt* this same role tonight, including the actor.
   *
   * Note this is not the size of the list of players shown to them: the Minion
   * is shown the werewolves, and is still alone in holding the Minion card.
   */
  holderCount: number;
}

export interface RoleDefinition {
  id: RoleId;
  team: Team;
  /** Copies of this card in the physical box; the deck builder enforces it. */
  maxCopies: number;
  /**
   * Position in the narrator's wake order, lower wakes first. `null` means the
   * role never wakes (Villager, Hunter, Tanner) and gets no night step.
   *
   * Values follow the official order and are spaced so a role can be slotted
   * in without renumbering anything: Werewolf 10, Minion 15, Masons 18, Seer
   * 20, Robber 30, Troublemaker 40, Drunk 45, Insomniac 50. The gap at 5 is
   * where the Doppelganger goes.
   */
  wakeOrder: number | null;
  /**
   * Whose cards are turned face up for this role at the start of its step, or
   * `null` for a role that recognises nobody.
   *
   * Usually the role's own id - werewolves recognise each other, and so do the
   * Masons. It is a role id rather than a boolean because recognition is not
   * always mutual: the Minion sees the werewolves, and they never see them.
   */
  sees: RoleId | null;
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
    sees: "werewolf",
    selection: ({ holderCount }) =>
      // A lone werewolf has nobody to recognise, so the rules let them peek at
      // one center card instead. With two or more wolves there is no choice.
      holderCount === 1 ? [{ id: "peek", source: "center", count: 1, excludeSelf: false }] : [],
  },

  /**
   * Works for the wolves and is shown who they are, without being seen back.
   * Not a werewolf card though: killing the Minion does not save the village.
   * See `isWerewolfCard` below.
   */
  minion: {
    id: "minion",
    team: "werewolf",
    maxCopies: 1,
    wakeOrder: 15,
    sees: "werewolf",
    selection: () => [],
  },

  /** The two Masons recognise each other, exactly as the werewolves do. */
  mason: {
    id: "mason",
    team: "village",
    maxCopies: 2,
    wakeOrder: 18,
    sees: "mason",
    selection: () => [],
  },

  seer: {
    id: "seer",
    team: "village",
    maxCopies: 1,
    wakeOrder: 20,
    sees: null,
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
    sees: null,
    selection: () => [{ id: "steal", source: "players", count: 1, excludeSelf: true }],
  },

  troublemaker: {
    id: "troublemaker",
    team: "village",
    maxCopies: 1,
    wakeOrder: 40,
    sees: null,
    selection: () => [{ id: "swap", source: "players", count: 2, excludeSelf: true }],
  },

  drunk: {
    id: "drunk",
    team: "village",
    maxCopies: 1,
    wakeOrder: 45,
    sees: null,
    selection: () => [{ id: "swap", source: "center", count: 1, excludeSelf: false }],
  },

  /** Wakes last, by design: what they see is the table as it finally stands. */
  insomniac: {
    id: "insomniac",
    team: "village",
    maxCopies: 1,
    wakeOrder: 50,
    sees: null,
    // Nothing to pick - the reveal fires when the step opens. See
    // `TURN_START_HANDLERS` in `src/server/game/roleHandlers.ts`.
    selection: () => [],
  },

  /** Never wakes; their whole rule is in the vote. See `resolution.ts`. */
  hunter: {
    id: "hunter",
    team: "village",
    maxCopies: 1,
    wakeOrder: null,
    sees: null,
    selection: () => [],
  },

  villager: {
    id: "villager",
    team: "village",
    maxCopies: 3,
    wakeOrder: null,
    sees: null,
    selection: () => [],
  },

  /** A team of one, who wins by being lynched. Never wakes. */
  tanner: {
    id: "tanner",
    team: "tanner",
    maxCopies: 1,
    wakeOrder: null,
    sees: null,
    selection: () => [],
  },
};

/** Deck-builder display order (also the lobby row order in the UI). */
export const ROLE_ORDER: RoleId[] = [
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "hunter",
  "villager",
  "tanner",
];

/**
 * True for cards that count as an actual werewolf when the round is judged.
 *
 * Deliberately not the same test as `team === "werewolf"`. The Minion wins
 * *with* the wolves but is not one: killing them does not save the village,
 * and a table whose only wolf-team card is the Minion counts as having no
 * werewolf in it at all.
 */
export function isWerewolfCard(role: RoleId): boolean {
  return ROLES[role].team === "werewolf" && role !== "minion";
}

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
