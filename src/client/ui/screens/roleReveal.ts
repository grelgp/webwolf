/**
 * Role reveal: the one moment a player is allowed to see their own card.
 *
 * It is short, and it is the last time. From the day phase onwards the server
 * simply stops sending the card, exactly like turning it face down on the
 * table - a Robber who did not pay attention really is left guessing, which is
 * how the physical game plays.
 */

import type { Actions } from "../../actions.js";
import { ROLE_EMOJI, ROLE_NAMES, ROLE_TAGLINES, UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { countdown, header, primaryButton } from "../components.js";
import { h } from "../dom.js";

export function renderRoleReveal(store: Store, actions: Actions): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  const role = state.private?.dealtRole;
  const you = state.players.find((player) => player.id === state.youId);
  const readyCount = state.players.filter((player) => player.ready).length;

  return h(
    "section",
    { class: "screen screen--reveal" },
    header({ title: UI.revealTitle, aside: countdown(store) }),

    role
      ? h(
          "div",
          { class: "card-hero" },
          h("span", { class: "card-hero__glyph", text: ROLE_EMOJI[role] }),
          h("strong", { class: "card-hero__name", text: ROLE_NAMES[role] }),
          h("p", { class: "card-hero__tagline", text: ROLE_TAGLINES[role] }),
        )
      : h("div", { class: "card-hero card-hero--empty" }, h("span", { text: "🂠" })),

    h("p", { class: "warning", text: UI.revealWarning }),

    h(
      "div",
      { class: "actions" },
      you?.ready
        ? h("p", { class: "muted", text: UI.revealWaiting(readyCount, state.players.length) })
        : primaryButton(UI.revealAck, () => actions.ready(), { class: "btn--block" }),
    ),
  );
}
