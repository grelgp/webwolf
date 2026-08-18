/**
 * The night.
 *
 * Two very different screens share this phase, and which one you get is
 * decided entirely by the server: if your snapshot carries `private.turn`, it
 * is your turn; if it does not, there is nothing on your device to see.
 *
 * The sleeping screen is deliberately almost empty and very dark. Players are
 * meant to have their eyes shut, and the phone is lying face up on the table
 * where anyone could glance at it.
 *
 * The acting screen is built generically from the role's `SelectionGroup`s, so
 * a new role with a familiar shape of choice needs no code here at all. Taps
 * accumulate until they satisfy one group, then submit on their own - the Seer
 * reads a player in one tap, two center cards in two.
 */

import { centerIndexes, slotKey, type CardSlot } from "../../../shared/roles.js";
import type { NightTurnView, RevealedCard } from "../../../shared/protocol.js";
import type { Actions } from "../../actions.js";
import { ROLE_NAMES, ROLE_NIGHT_PROMPTS, UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { banner, countdown, ghostButton, header, stage, tile, tileGrid } from "../components.js";
import { h } from "../dom.js";

export function renderNight(store: Store, actions: Actions): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  const turn = state.private?.turn;
  return turn ? renderTurn(store, actions, turn) : renderSleeping(store);
}

/* -------------------------------------------------------------------------- */
/* Everyone whose role is not being called                                    */
/* -------------------------------------------------------------------------- */

function renderSleeping(store: Store): HTMLElement {
  const state = store.state.server;
  const night = state?.night;

  return h(
    "section",
    { class: "screen screen--night screen--asleep" },
    h(
      "div",
      { class: "asleep" },
      h("span", { class: "asleep__glyph", text: "🌙" }),
      h("h1", { class: "asleep__title", text: UI.nightTitle }),
      h("p", { class: "asleep__instruction", text: UI.nightKeepEyesClosed }),
      night &&
        h("p", {
          class: "asleep__step",
          // Public information: the narrator says this role's name out loud.
          text: UI.nightStep(night.step, night.stepCount, ROLE_NAMES[night.role]),
        }),
      countdown(store),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* The player being called                                                    */
/* -------------------------------------------------------------------------- */

function renderTurn(store: Store, actions: Actions, turn: NightTurnView): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  const revealedBySlot = new Map<string, RevealedCard>();
  for (const card of turn.revealed) revealedBySlot.set(slotKey(card.slot), card);

  const swapped = new Set(turn.swapped.map(slotKey));

  // Fellow role-holders are shown face up: this is how werewolves recognise
  // each other without anyone opening their eyes.
  const fellows = new Set(turn.fellows);

  const wantsPlayers =
    turn.groups.some((group) => group.source === "players") ||
    fellows.size > 0 ||
    [...revealedBySlot.values()].some((card) => card.slot.kind === "player") ||
    turn.swapped.some((slot) => slot.kind === "player");

  const wantsCenter =
    turn.groups.some((group) => group.source === "center") ||
    [...revealedBySlot.values()].some((card) => card.slot.kind === "center") ||
    turn.swapped.some((slot) => slot.kind === "center");

  const isSelectable = (slot: CardSlot): boolean =>
    turn.groups.some((group) => {
      if (group.source !== (slot.kind === "player" ? "players" : "center")) return false;
      if (group.excludeSelf && slot.kind === "player" && slot.playerId === state.youId) return false;
      return true;
    });

  const tileFor = (slot: CardSlot, label: string, selfNote?: string) => {
    const revealed = revealedBySlot.get(slotKey(slot));
    const isFellow = slot.kind === "player" && fellows.has(slot.playerId);

    if (revealed) {
      return tile({ label, role: revealed.role, state: "revealed", note: selfNote });
    }
    if (isFellow) {
      return tile({ label, role: turn.role, state: "revealed", note: UI.fellowNote });
    }
    if (swapped.has(slotKey(slot))) {
      return tile({ label, state: "revealed", note: UI.swappedNote });
    }
    if (isSelectable(slot)) {
      return tile({
        label,
        state: store.isSelected(slot) ? "selected" : "selectable",
        note: selfNote,
        onClick: () => actions.tapSlot(slot),
      });
    }
    return tile({ label, state: "muted", note: selfNote });
  };

  return h(
    "section",
    { class: "screen screen--night screen--turn" },
    header({
      title: ROLE_NAMES[turn.role],
      subtitle: turnPrompt(turn),
      aside: countdown(store),
    }),

    stage(
      wantsPlayers &&
        tileGrid(
          state.players.map((player) =>
            tileFor(
              { kind: "player", playerId: player.id },
              player.nickname,
              player.id === state.youId ? UI.youBadge : undefined,
            ),
          ),
        ),

      wantsCenter &&
        tileGrid(
          centerIndexes().map((index) =>
            tileFor({ kind: "center", index }, UI.centerCard(index)),
          ),
        ),

      turn.resolved && banner(resolvedMessage(turn), "info"),
    ),

    turn.resolved
      ? null
      : h("div", { class: "actions" }, ghostButton(UI.nightSkip, () => actions.skipNight())),
  );
}

/** The instruction line under the role name. */
function turnPrompt(turn: NightTurnView): string {
  // A lone werewolf has nobody to recognise and is offered the center peek
  // instead; the generic prompt would be misleading.
  if (turn.role === "werewolf") {
    return turn.passive ? ROLE_NIGHT_PROMPTS.werewolf : UI.nightAlone;
  }
  return ROLE_NIGHT_PROMPTS[turn.role];
}

/** What to show once the action is spent, for the rest of the step. */
function resolvedMessage(turn: NightTurnView): string {
  if (turn.passive) return UI.nightNothingToDo;
  if (turn.revealed.length > 0) {
    return turn.role === "robber" ? UI.nightRobbedInto : UI.nightYouSee;
  }
  if (turn.swapped.length > 0) return `${UI.nightSwapDone} ${UI.nightCloseAgain}`;
  return UI.nightSkipped;
}

/* -------------------------------------------------------------------------- */
/* Selection logic                                                            */
/* -------------------------------------------------------------------------- */

export interface TapResult {
  /** Slots still pending, to be shown as selected. */
  selection: CardSlot[];
  /** Set when the tap completed a group and the action should be sent. */
  submit?: { groupId: string; slots: CardSlot[] };
}

/**
 * Folds one tap into the current selection.
 *
 * Kept separate from rendering, and exported, because it is the one piece of
 * client logic with real rules in it:
 *
 * - tapping an already-selected slot removes it;
 * - a tap that no open group could accommodate starts a fresh selection rather
 *   than being rejected, so the player never gets stuck on a dead end;
 * - as soon as the selection exactly fills a group, it is submitted, which is
 *   what keeps every night action to the minimum number of taps.
 */
export function applyTap(
  turn: NightTurnView,
  current: readonly CardSlot[],
  slot: CardSlot,
): TapResult {
  const key = slotKey(slot);
  if (current.some((candidate) => slotKey(candidate) === key)) {
    return { selection: current.filter((candidate) => slotKey(candidate) !== key) };
  }

  const fits = (group: NightTurnView["groups"][number], slots: readonly CardSlot[]) =>
    slots.length <= group.count &&
    slots.every((candidate) => group.source === (candidate.kind === "player" ? "players" : "center"));

  let next = [...current, slot];
  let viable = turn.groups.filter((group) => fits(group, next));

  if (viable.length === 0) {
    // Mixing sources, or overflowing every group: treat the tap as the start
    // of a new selection instead of ignoring it.
    next = [slot];
    viable = turn.groups.filter((group) => fits(group, next));
  }

  const complete = viable.find((group) => group.count === next.length);
  if (complete) return { selection: [], submit: { groupId: complete.id, slots: next } };

  return { selection: next };
}
