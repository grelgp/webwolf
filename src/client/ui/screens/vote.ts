/**
 * Vote: one tap on the player you want eliminated.
 *
 * Votes stay changeable until everyone has locked one in, which reproduces the
 * simultaneous "point on three" of the physical game: the progress line shows
 * *how many* have voted but never *for whom*, so nobody can follow a majority
 * that is already forming.
 *
 * The round resolves as soon as the last connected player votes, or when the
 * timer runs out - whichever comes first.
 */

import type { Actions } from "../../actions.js";
import { UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { banner, countdown, header, stage, tile, tileGrid } from "../components.js";
import { h } from "../dom.js";

export function renderVote(store: Store, actions: Actions): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  const myVote = state.private?.vote;
  const progress = state.voteProgress;

  return h(
    "section",
    { class: "screen screen--vote" },
    header({ title: UI.voteTitle, subtitle: UI.voteInstruction, aside: countdown(store) }),

    stage(
      tileGrid(
        state.players.map((player) => {
          // You cannot point at yourself, exactly as in the printed rules.
          const isSelf = player.id === state.youId;
          return tile({
            label: player.nickname,
            state: isSelf ? "muted" : myVote === player.id ? "selected" : "selectable",
            note: isSelf ? UI.youBadge : player.hasVoted ? "✓" : undefined,
            onClick: isSelf ? undefined : () => actions.castVote(player.id),
          });
        }),
      ),

      myVote && banner(`${UI.voteYours(store.playerName(myVote))} — ${UI.voteChangeable}`, "info"),
      progress && h("p", { class: "muted", text: UI.voteProgress(progress.voted, progress.total) }),
    ),
  );
}
