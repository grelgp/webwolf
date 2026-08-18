/**
 * Dealing.
 *
 * The composition rules live in `src/shared/deck.ts` because the lobby needs
 * them too. Only the shuffle stays here: it uses the crypto RNG and must never
 * be reachable from the browser.
 */

import { CENTER_CARD_COUNT } from "../../shared/constants.js";
import type { RoleId } from "../../shared/roles.js";
import { shuffled } from "../util/random.js";

export interface Deal {
  /** Card dealt to each player, keyed by player id. */
  dealt: Map<string, RoleId>;
  /** The three face-down cards, in table order. */
  center: RoleId[];
}

/**
 * Shuffles the deck and deals one card per player plus the center three.
 *
 * Callers must have validated the deck first; a deck shorter than
 * `players + 3` would silently leave seats or center slots undefined.
 */
export function dealCards(deck: readonly RoleId[], playerIds: readonly string[]): Deal {
  const cards = shuffled(deck);
  const dealt = new Map<string, RoleId>();
  playerIds.forEach((playerId, index) => {
    dealt.set(playerId, cards[index] as RoleId);
  });
  const center = cards.slice(playerIds.length, playerIds.length + CENTER_CARD_COUNT);
  return { dealt, center };
}
