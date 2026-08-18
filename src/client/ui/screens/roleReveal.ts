/**
 * Role reveal: the one moment a player is allowed to see their own card.
 *
 * It is short, and it is the last time. From the day phase onwards the server
 * simply stops sending the card, exactly like turning it face down on the
 * table - a Robber who did not pay attention really is left guessing, which is
 * how the physical game plays.
 *
 * Nothing is shown until somebody asks for it. The phase opens on a gate
 * naming whose card is next, and the card only appears after a deliberate tap:
 * a phone lying face up on the table when the round starts must not reveal
 * anything by itself. On a shared device the gate runs twice, one player after
 * the other, and the screen re-locks between them - which is the whole reason
 * two people can play from one phone at all.
 */

import type { ClientState } from "../../../shared/protocol.js";
import type { Actions } from "../../actions.js";
import { ROLE_EMOJI, ROLE_NAMES, ROLE_TAGLINES, UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { countdown, handover, header, primaryButton } from "../components.js";
import { h } from "../dom.js";

export function renderRoleReveal(store: Store, actions: Actions): HTMLElement {
  const state = store.base;
  if (!state) return h("section", { class: "screen" });

  const active = store.active;
  if (active) return renderCard(store, actions, active);

  return renderGate(store, state);
}

/* -------------------------------------------------------------------------- */
/* The gate: whose card is next                                               */
/* -------------------------------------------------------------------------- */

function renderGate(store: Store, state: ClientState): HTMLElement {
  // In seat order, so a shared phone always goes round the same way.
  const pending = store.seats.filter((seat) => !store.hasSeenCard(seat.youId));
  const readyCount = state.players.filter((player) => player.ready).length;

  if (pending.length === 0) {
    return h(
      "section",
      { class: "screen screen--reveal" },
      header({ title: UI.revealTitle, aside: countdown(store) }),
      h(
        "div",
        { class: "stage" },
        h("span", { class: "handover__glyph", text: "✅" }),
        h("p", { class: "muted", text: UI.revealWaiting(readyCount, state.players.length) }),
      ),
    );
  }

  const next = pending[0];
  if (!next) return h("section", { class: "screen" });
  const nickname = store.playerName(next.youId);

  return h(
    "section",
    { class: "screen screen--reveal screen--gate" },
    handover({
      title: store.shared ? UI.revealTitleFor(nickname) : UI.revealTitle,
      instruction: store.shared ? UI.revealGateShared(nickname) : UI.revealGateSolo,
      caution: UI.revealGateCaution,
      aside: countdown(store),
      seats: [
        {
          label: store.shared ? UI.revealGateButton(nickname) : UI.revealGateButtonSolo,
          onOpen: () => store.openSeat(next.youId),
        },
      ],
      // A shared phone shows how far round the table it has got, so the pair
      // can tell at a glance whether the second card is still owed a look.
      footer:
        store.shared &&
        h(
          "ul",
          { class: "seat-progress" },
          store.seats.map((seat) => {
            const seen = store.hasSeenCard(seat.youId);
            return h("li", {
              class: `seat-progress__row ${seen ? "seat-progress__row--done" : ""}`.trim(),
              text: `${store.playerName(seat.youId)} — ${
                seen ? UI.revealSeatDone : UI.revealSeatWaiting
              }`,
            });
          }),
        ),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* The card itself                                                            */
/* -------------------------------------------------------------------------- */

function renderCard(store: Store, actions: Actions, seat: ClientState): HTMLElement {
  const role = seat.private?.dealtRole;
  const nickname = store.playerName(seat.youId);

  return h(
    "section",
    { class: "screen screen--reveal" },
    header({
      title: store.shared ? UI.revealTitleFor(nickname) : UI.revealTitle,
      aside: countdown(store),
    }),

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
      // Acknowledging also re-locks the screen, so on a shared phone the very
      // next thing rendered is the gate for the other player.
      primaryButton(UI.revealAck, () => actions.ready(seat.youId), { class: "btn--block" }),
    ),
  );
}
