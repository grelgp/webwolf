/**
 * Deck composition rules.
 *
 * Shared on purpose. The server enforces these before dealing, and the lobby
 * runs exactly the same checks to grey out the start button and explain why -
 * so the host can never be told "invalid deck" by a rule the UI did not show
 * them first.
 *
 * The rule everything rests on: the deck always holds `players + 3` cards.
 * Three of them stay face down in the middle, which is what makes any single
 * player's own card untrustworthy and the whole game work.
 */

import { CENTER_CARD_COUNT, MIN_PLAYERS } from "./constants.js";
import { ROLES, ROLE_ORDER, isRoleId, type RoleId } from "./roles.js";

export type DeckCounts = Partial<Record<RoleId, number>>;

/** Number of cards a table of `playerCount` needs. */
export function requiredDeckSize(playerCount: number): number {
  return playerCount + CENTER_CARD_COUNT;
}

export type DeckProblem =
  | "too_few_players"
  | "wrong_size"
  | "too_many_copies"
  | "no_werewolf"
  | "unknown_role";

export interface DeckValidation {
  ok: boolean;
  /** Machine-readable reason; `deckProblem()` in the i18n module phrases it. */
  reason?: DeckProblem;
  /** Context for the message, e.g. the size the deck should have had. */
  detail?: Record<string, string | number>;
}

/**
 * Normalises an untrusted `{ roleId: count }` map into a flat card list.
 * Unknown keys and out-of-range counts are clamped rather than rejected, so a
 * slightly stale client can never wedge the lobby.
 */
export function countsToDeck(counts: DeckCounts): RoleId[] {
  const deck: RoleId[] = [];
  for (const roleId of ROLE_ORDER) {
    const raw = counts[roleId];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const clamped = Math.max(0, Math.min(Math.floor(raw), ROLES[roleId].maxCopies));
    for (let i = 0; i < clamped; i += 1) deck.push(roleId);
  }
  return deck;
}

export function deckToCounts(deck: readonly RoleId[]): Record<RoleId, number> {
  const counts = {} as Record<RoleId, number>;
  for (const roleId of ROLE_ORDER) counts[roleId] = 0;
  for (const card of deck) counts[card] += 1;
  return counts;
}

/**
 * Checks a deck against the rules for a given table size.
 *
 * Requiring at least one Werewolf card is a house rule on top of the printed
 * ones. A wolf-free deck is legal on paper, but it produces a round the
 * village can only win by unanimously sparing everyone - a baffling first
 * experience, and easy to create by accident while dragging counters around.
 */
export function validateDeck(deck: readonly RoleId[], playerCount: number): DeckValidation {
  if (playerCount < MIN_PLAYERS) {
    return { ok: false, reason: "too_few_players", detail: { min: MIN_PLAYERS } };
  }

  for (const card of deck) {
    if (!isRoleId(card)) return { ok: false, reason: "unknown_role" };
  }

  const counts = deckToCounts(deck);
  for (const roleId of ROLE_ORDER) {
    if (counts[roleId] > ROLES[roleId].maxCopies) {
      return { ok: false, reason: "too_many_copies", detail: { role: roleId } };
    }
  }

  const required = requiredDeckSize(playerCount);
  if (deck.length !== required) {
    return { ok: false, reason: "wrong_size", detail: { required, actual: deck.length } };
  }

  if (counts.werewolf === 0) {
    return { ok: false, reason: "no_werewolf" };
  }

  return { ok: true };
}

/**
 * Cards a suggested deck reaches for, in order, added one group at a time.
 *
 * Grouped rather than flat because some cards only make sense together: the
 * Masons are a pair, and a deck holding exactly one of them would give its
 * holder a partner who is always in the center. A group that would overshoot
 * the target is skipped and the next one tried, so every table size still
 * lands on a full deck.
 */
const DECK_PREFERENCE: readonly (readonly RoleId[])[] = [
  ["werewolf", "werewolf"],
  ["seer"],
  ["robber"],
  ["troublemaker"],
  ["villager"],
  ["villager"],
  ["villager"],
  ["mason", "mason"],
  ["insomniac"],
  ["drunk"],
  ["minion"],
  ["hunter"],
  ["tanner"],
];

/**
 * A playable default deck for `playerCount`, used when a room opens and
 * whenever the table size changes under a now-invalid deck.
 *
 * Priority order: two Werewolves, then the classic specials, then Villagers,
 * then the rest of the box as the table outgrows them. Returns a short deck if
 * the registered roles cannot fill the table, which `validateDeck` then
 * reports as `wrong_size`.
 */
export function suggestDeck(playerCount: number): RoleId[] {
  const target = requiredDeckSize(playerCount);
  const deck: RoleId[] = [];

  for (const group of DECK_PREFERENCE) {
    if (deck.length + group.length > target) continue;
    deck.push(...group);
    if (deck.length === target) break;
  }

  return deck;
}
