/**
 * Reveal: every card face up, for everyone, at the same instant.
 *
 * This is the payoff screen, and the one place the app can do something the
 * cardboard cannot: show both what each player was *dealt* and what they
 * *ended up as*, so the table can reconstruct the night without arguing about
 * who moved which card.
 */

import { centerIndexes } from "../../../shared/roles.js";
import type { RoundResult } from "../../../shared/protocol.js";
import type { Actions } from "../../actions.js";
import { ROLE_EMOJI, ROLE_NAMES, UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { banner, header, primaryButton, tile, tileGrid } from "../components.js";
import { h } from "../dom.js";

export function renderResult(store: Store, actions: Actions): HTMLElement {
  const state = store.base;
  if (!state?.result) return h("section", { class: "screen" });

  const result = state.result;
  const eliminated = new Set(result.eliminated);
  // Shot by a Hunter rather than elected: without this the row would show a
  // dead player with no votes against them and no explanation.
  const hunted = new Set(result.hunted);

  return h(
    "section",
    { class: `screen screen--result screen--result-${result.outcome}` },
    header({
      title: UI.outcomeTitle(result.outcome),
      subtitle: UI.outcomeDetail(result.outcome),
    }),

    result.noOneDied && banner(UI.nobodyDied, "info"),
    result.hunted.length > 0 && banner(UI.huntedNote, "warn"),

    h(
      "div",
      { class: "panel" },
      h(
        "ul",
        { class: "result-list" },
        state.players.map((player) => {
          const dealt = result.dealtRoles[player.id];
          const final = result.finalRoles[player.id];
          const votes = result.tally[player.id] ?? 0;

          return h(
            "li",
            { class: `result-row ${eliminated.has(player.id) ? "result-row--dead" : ""}`.trim() },
            h("span", { class: "result-row__name", text: player.nickname }),
            h(
              "span",
              { class: "result-row__roles" },
              dealt && h("span", { class: "role-chip", text: roleLabel(dealt) }),
              // Only show the arrow when the card actually changed hands;
              // otherwise the line reads as if something happened when nothing did.
              dealt && final && dealt !== final
                ? h("span", { class: "result-row__arrow", text: UI.dealtToFinal })
                : null,
              dealt && final && dealt !== final
                ? h("span", { class: "role-chip role-chip--final", text: roleLabel(final) })
                : null,
            ),
            h("span", { class: "result-row__votes", text: UI.votesReceived(votes) }),
            eliminated.has(player.id) &&
              h("span", {
                class: hunted.has(player.id) ? "chip chip--hunted" : "chip chip--dead",
                text: hunted.has(player.id) ? UI.huntedLabel : UI.eliminatedLabel,
              }),
          );
        }),
      ),
    ),

    h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel__title", text: UI.centerTitle }),
      tileGrid(
        centerIndexes().map((index) =>
          tile({
            label: UI.centerCard(index),
            role: result.centerRoles[index],
            state: "revealed",
          }),
        ),
      ),
    ),

    store.isHost
      ? h(
          "div",
          { class: "actions" },
          primaryButton(UI.playAgain, () => actions.playAgain(), { class: "btn--block" }),
        )
      : h("p", { class: "muted", text: UI.waitingForHost }),
  );
}

function roleLabel(role: RoundResult["centerRoles"][number]): string {
  return `${ROLE_EMOJI[role]} ${ROLE_NAMES[role]}`;
}
