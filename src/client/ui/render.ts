/**
 * Screen dispatch and the single global ticker.
 *
 * The whole screen is rebuilt on every server snapshot. It is cheap at this
 * scale and it guarantees that when a phase ends, everything it put on screen
 * disappears with it - no stale secret can survive in a detached node.
 *
 * The one thing that must survive a rebuild is the countdown, so it is not
 * re-rendered at all: a single interval refreshes every element carrying
 * `data-countdown`, wherever the current screen happens to have put it.
 */

import type { Actions } from "../actions.js";
import { formatClock, UI } from "../i18n/fr.js";
import type { Store } from "../store.js";
import { banner } from "./components.js";
import { h, mount } from "./dom.js";
import { renderAddPlayer } from "./screens/addPlayer.js";
import { renderDay } from "./screens/day.js";
import { renderHome } from "./screens/home.js";
import { renderLobby } from "./screens/lobby.js";
import { renderNight } from "./screens/night.js";
import { renderResult } from "./screens/result.js";
import { renderRoleReveal } from "./screens/roleReveal.js";
import { renderVote } from "./screens/vote.js";

const TICK_MS = 250;

export function createRenderer(root: HTMLElement, store: Store, actions: Actions): () => void {
  const tick = () => {
    const remaining = store.remainingMs();
    if (remaining === null) return;
    const text = formatClock(remaining);
    for (const node of document.querySelectorAll<HTMLElement>("[data-countdown]")) {
      if (node.textContent !== text) node.textContent = text;
    }
  };
  window.setInterval(tick, TICK_MS);

  return () => {
    const state = store.base;

    // A dropped connection mid-round is common (a locked phone is enough), so
    // it gets a persistent strip rather than a transient error.
    const offline =
      state && store.state.status !== "open"
        ? banner(store.state.status === "closed" ? UI.offline : UI.reconnecting, "warn")
        : null;

    mount(root, offline, screenFor(store, actions));
    // Themed per phase so the night is genuinely dark on a table full of
    // face-up phones.
    document.body.dataset.phase = state?.phase ?? "home";
    tick();
  };
}

function screenFor(store: Store, actions: Actions): HTMLElement {
  const state = store.base;
  if (!state) return renderHome(store, actions);

  // Seating a companion takes over the screen, because it is the one place in
  // a room with a text field and the lobby underneath rebuilds constantly.
  if (store.state.addingPlayer) return renderAddPlayer(store, actions);

  switch (state.phase) {
    case "lobby":
      return renderLobby(store, actions);
    case "role_reveal":
      return renderRoleReveal(store, actions);
    case "night":
      return renderNight(store, actions);
    case "day":
      return renderDay(store, actions);
    case "vote":
      return renderVote(store, actions);
    case "reveal":
      return renderResult(store, actions);
    default:
      // Unreachable while client and server agree on the protocol version;
      // rendering nothing beats throwing inside a render pass.
      return h("section", { class: "screen" });
  }
}
