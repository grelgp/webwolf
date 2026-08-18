/**
 * Vote counting and win conditions.
 *
 * Both follow the printed rules of One Night Ultimate Werewolf, including the
 * clauses that surprise new players:
 *
 * - If every player receives exactly one vote, nobody dies. This is what makes
 *   a werewolf-free round survivable: the table can agree to spread the vote.
 * - With no Werewolf among the players, the village wins only if nobody dies.
 *   If the table lynches an innocent anyway, there is no winner at all.
 * - The Tanner wins by being lynched, and takes the werewolves' win with them.
 * - The Minion is on the werewolf team without being a werewolf, so killing
 *   them saves nobody.
 *
 * The order things happen in matters: the vote elects the victims, the Hunter
 * then fires, and only the resulting list of the dead decides the round.
 */

import type { PlayerId, RoundOutcome } from "../../shared/protocol.js";
import type { RoleId } from "../../shared/roles.js";
import { isWerewolfCard } from "../../shared/roles.js";

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
 * Extra victims claimed by a Hunter who was voted out.
 *
 * "If the Hunter dies, the player they voted for dies too." The shot is fired
 * on the card the Hunter *holds at dawn*, like every other win-condition test,
 * so a player who was handed the Hunter card during the night shoots and one
 * who gave it away does not.
 *
 * @param eliminated Players the vote killed.
 * @param votes      voterId -> targetId, the same map the vote was counted on.
 * @param finalRoles Card in front of each player at dawn.
 * @returns the players shot, in the order they fell; never anyone already dead.
 */
export function applyHunterShots(
  eliminated: readonly PlayerId[],
  votes: ReadonlyMap<PlayerId, PlayerId>,
  finalRoles: ReadonlyMap<PlayerId, RoleId>,
): PlayerId[] {
  const dead = new Set(eliminated);
  const shot: PlayerId[] = [];

  // A worklist rather than a single pass: the box only holds one Hunter card,
  // but a victim who is one fires in turn rather than dying quietly.
  const pending = [...eliminated];
  while (pending.length > 0) {
    const id = pending.shift() as PlayerId;
    if (finalRoles.get(id) !== "hunter") continue;

    const target = votes.get(id);
    // A Hunter who never voted takes nobody with them, and neither vote nor
    // shot can land on someone already lying on the floor.
    if (target === undefined || dead.has(target)) continue;

    dead.add(target);
    shot.push(target);
    pending.push(target);
  }

  return shot;
}

/**
 * @param finalRoles Card in front of each player at dawn, after every swap.
 * @param eliminated Everyone who died, the Hunter's victims included.
 */
export function decideOutcome(
  finalRoles: ReadonlyMap<PlayerId, RoleId>,
  eliminated: readonly PlayerId[],
): RoundOutcome {
  const roleOf = (id: PlayerId): RoleId | undefined => finalRoles.get(id);
  const diedAs = (test: (role: RoleId) => boolean) =>
    eliminated.some((id) => {
      const role = roleOf(id);
      return role !== undefined && test(role);
    });

  const killedAWolf = diedAs(isWerewolfCard);

  // Checked first, because a dead Tanner overrides everything else: they win,
  // the werewolves do not, and the village only shares the win if a wolf fell
  // with them.
  if (diedAs((role) => role === "tanner")) {
    return killedAWolf ? "tanner_village" : "tanner";
  }

  const werewolvesAtTable = [...finalRoles.values()].some(isWerewolfCard);
  if (werewolvesAtTable) return killedAWolf ? "village" : "werewolf";

  // No wolf ever sat down. A Minion at the table still plays for them, and
  // wins as long as somebody other than themselves takes the fall.
  if ([...finalRoles.values()].includes("minion")) {
    return diedAs((role) => role !== "minion") ? "werewolf" : "village";
  }

  // Nobody was playing for the wolves: sparing everyone is the only way to win.
  return eliminated.length === 0 ? "village" : "nobody";
}
