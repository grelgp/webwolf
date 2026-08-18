/**
 * Vote counting and win conditions.
 *
 * Both follow the printed rules of One Night Ultimate Werewolf, including the
 * two clauses that surprise new players:
 *
 * - If every player receives exactly one vote, nobody dies. This is what makes
 *   a werewolf-free round survivable: the table can agree to spread the vote.
 * - With no Werewolf among the players, the village wins only if nobody dies.
 *   If the table lynches an innocent anyway, there is no winner at all.
 */

import type { PlayerId, RoundOutcome } from "../../shared/protocol.js";
import type { RoleId } from "../../shared/roles.js";
import { ROLES } from "../../shared/roles.js";

export interface VoteOutcome {
  /** Votes received per player, including players who received none. */
  tally: Record<PlayerId, number>;
  eliminated: PlayerId[];
  /** True when the "one vote each" rule spared the whole table. */
  noOneDied: boolean;
}

/**
 * @param votes    voterId -> targetId. Players who never voted are absent.
 * @param seatIds  every player at the table, so the tally covers everyone.
 */
export function countVotes(
  votes: ReadonlyMap<PlayerId, PlayerId>,
  seatIds: readonly PlayerId[],
): VoteOutcome {
  const tally: Record<PlayerId, number> = {};
  for (const id of seatIds) tally[id] = 0;
  for (const target of votes.values()) {
    // Ignore votes aimed at a seat that no longer exists.
    if (tally[target] !== undefined) tally[target] += 1;
  }

  const everyoneVoted = votes.size === seatIds.length;
  const spreadEvenly = seatIds.every((id) => tally[id] === 1);
  if (everyoneVoted && spreadEvenly && seatIds.length > 0) {
    return { tally, eliminated: [], noOneDied: true };
  }

  let highest = 0;
  for (const id of seatIds) highest = Math.max(highest, tally[id] ?? 0);

  // Nobody pointed at anyone (everyone disconnected, say): nobody dies.
  if (highest === 0) return { tally, eliminated: [], noOneDied: true };

  // Ties kill everyone tied, exactly as in the physical game.
  const eliminated = seatIds.filter((id) => tally[id] === highest);
  return { tally, eliminated, noOneDied: false };
}

/**
 * @param finalRoles Card in front of each player at dawn, after every swap.
 * @param eliminated Players killed by the vote.
 */
export function decideOutcome(
  finalRoles: ReadonlyMap<PlayerId, RoleId>,
  eliminated: readonly PlayerId[],
): RoundOutcome {
  const werewolvesAtTable = [...finalRoles.values()].some(
    (role) => ROLES[role].team === "werewolf",
  );

  if (!werewolvesAtTable) {
    // No wolf ever sat down. Sparing everyone is the only way to win.
    return eliminated.length === 0 ? "village" : "nobody";
  }

  const killedAWolf = eliminated.some((id) => {
    const role = finalRoles.get(id);
    return role !== undefined && ROLES[role].team === "werewolf";
  });

  return killedAWolf ? "village" : "werewolf";
}
