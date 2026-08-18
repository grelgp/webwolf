/**
 * What each role actually does when it acts.
 *
 * `src/shared/roles.ts` declares *what a player may click*; this file decides
 * *what happens when they do*. The split matters: the selection rules have to
 * be known by the browser to draw the grid, but the effects touch the deal and
 * must stay on the server.
 *
 * Adding a role means adding one entry here. See `docs/adding-a-role.md`.
 */

import { getRole, type CardSlot, type RoleId, type SelectionGroup } from "../../shared/roles.js";
import type { PlayerId } from "../../shared/protocol.js";
import { readSlot, swapSlots, uniqueSlots, type NightState, type TurnState } from "./nightState.js";

export interface NightActionContext {
  night: NightState;
  actorId: PlayerId;
  /** Players turned face up for this actor - see `sees` in the registry. */
  fellows: readonly PlayerId[];
  /** The player's turn record, mutated in place by the handler. */
  turn: TurnState;
}

/**
 * Applies a validated selection. Handlers may assume the selection already
 * matches one of the role's declared groups - `validateSelection` below has
 * run first - so they only implement the effect.
 */
export type NightHandler = (
  context: NightActionContext,
  groupId: string,
  slots: readonly CardSlot[],
) => void;

function reveal(context: NightActionContext, slot: CardSlot): void {
  const role = readSlot(context.night, slot);
  if (role) context.turn.revealed.push({ slot, role });
}

const NOOP: NightHandler = () => {};

export const ROLE_HANDLERS: Record<RoleId, NightHandler> = {
  /**
   * Werewolves recognise each other automatically (handled by `sees` when the
   * turn view is built). A lone wolf gets to peek at one center card instead,
   * which is this handler's only job.
   */
  werewolf: (context, _groupId, slots) => {
    const slot = slots[0];
    if (slot) reveal(context, slot);
  },

  /** Looks at one other player's card, or two of the center cards. */
  seer: (context, _groupId, slots) => {
    for (const slot of slots) reveal(context, slot);
  },

  /**
   * Takes another player's card and leaves their own in its place, then looks
   * at what they now hold. The victim is not told - they will still act as the
   * Robber tonight if their turn has not passed, because turns follow `dealt`.
   */
  robber: (context, _groupId, slots) => {
    const target = slots[0];
    if (!target) return;
    const self: CardSlot = { kind: "player", playerId: context.actorId };
    if (!swapSlots(context.night, self, target)) return;
    context.turn.swapped.push(self, target);
    // Read *after* the swap: this is the card the Robber has just acquired.
    reveal(context, self);
  },

  /** Swaps two other players' cards without looking at either. */
  troublemaker: (context, _groupId, slots) => {
    const [first, second] = slots;
    if (!first || !second) return;
    if (!swapSlots(context.night, first, second)) return;
    context.turn.swapped.push(first, second);
  },

  /**
   * Takes a center card in exchange for their own and looks at neither, so
   * they spend the day genuinely not knowing what they are. Note the absence
   * of a `reveal()` call: that is the whole role.
   */
  drunk: (context, _groupId, slots) => {
    const target = slots[0];
    if (!target) return;
    const self: CardSlot = { kind: "player", playerId: context.actorId };
    if (!swapSlots(context.night, self, target)) return;
    context.turn.swapped.push(self, target);
  },

  /** Recognises the other Mason; nothing to submit. */
  mason: NOOP,

  /** Shown the werewolves when the step opens; nothing to submit. */
  minion: NOOP,

  /** Acts when the step opens, not in response to a choice. */
  insomniac: NOOP,

  /** Sleeps through the night. Their rule is in the vote, not here. */
  hunter: NOOP,

  /** Sleeps through the night. */
  villager: NOOP,

  /** Sleeps through the night, and hopes to be lynched in the morning. */
  tanner: NOOP,
};

/**
 * Effects that fire when a role's step *opens*, rather than in response to a
 * submitted action.
 *
 * A role with an empty `selection` has nothing to click, so its turn would
 * otherwise never reach a handler. The Insomniac is exactly that: no choice to
 * make, and still something to learn. `Room.runNightStep` runs these for every
 * holder of the role being called and marks the turn resolved.
 */
export type TurnStartHandler = (context: NightActionContext) => void;

export const TURN_START_HANDLERS: Partial<Record<RoleId, TurnStartHandler>> = {
  /**
   * Looks at their own card at the very end of the night - which is why they
   * wake last. Read from `playerCards`, so a Robber or Troublemaker who moved
   * it earlier is exactly what makes this worth doing.
   */
  insomniac: (context) => {
    reveal(context, { kind: "player", playerId: context.actorId });
  },
};

/* -------------------------------------------------------------------------- */
/* Selection validation                                                       */
/* -------------------------------------------------------------------------- */

export type SelectionError =
  | "unknown_group"
  | "wrong_count"
  | "duplicate_slot"
  | "wrong_source"
  | "self_not_allowed";

/**
 * Checks an incoming selection against the role's own declared groups.
 *
 * This is the authoritative check - the client's grid is a convenience, and a
 * hand-crafted frame trying to have the Seer read four cards or the
 * Troublemaker swap its own seat is rejected here.
 */
export function validateSelection(
  role: RoleId,
  groups: readonly SelectionGroup[],
  groupId: string,
  slots: readonly CardSlot[],
  actorId: PlayerId,
): SelectionError | null {
  void getRole(role); // fails loudly if an unknown role ever reaches this point

  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return "unknown_group";
  if (slots.length !== group.count) return "wrong_count";
  if (!uniqueSlots(slots)) return "duplicate_slot";

  for (const slot of slots) {
    const expected = group.source === "players" ? "player" : "center";
    if (slot.kind !== expected) return "wrong_source";
    if (group.excludeSelf && slot.kind === "player" && slot.playerId === actorId) {
      return "self_not_allowed";
    }
  }

  return null;
}
