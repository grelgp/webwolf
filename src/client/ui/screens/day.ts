/**
 * Day: discussion.
 *
 * Nothing secret is on screen, and that includes the player's own card. In the
 * physical game your card is face down in front of you and you may not look at
 * it again; re-showing it here would quietly remove the doubt that makes the
 * Robber and the Troublemaker interesting.
 *
 * The tiles are therefore purely a seating chart - useful for pointing at
 * someone by name across a noisy table.
 */

import type { Actions } from "../../actions.js";
import { UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { countdown, header, primaryButton, stage, tile, tileGrid } from "../components.js";
import { h } from "../dom.js";

export function renderDay(store: Store, actions: Actions): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  return h(
    "section",
    { class: "screen screen--day" },
    header({ title: UI.dayTitle, subtitle: UI.dayInstruction, aside: countdown(store) }),

    stage(
      tileGrid(
        state.players.map((player) =>
          tile({
            label: player.nickname,
            state: "idle",
            note: player.id === state.youId ? UI.youBadge : undefined,
          }),
        ),
      ),
    ),

    state.isHost &&
      h(
        "div",
        { class: "actions" },
        primaryButton(UI.endDiscussion, () => actions.endDiscussion(), { class: "btn--block" }),
      ),
  );
}
