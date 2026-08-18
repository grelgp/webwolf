/**
 * Vote: one tap on the player you want eliminated.
 *
 * Votes stay changeable until everyone has locked one in, which reproduces the
 * simultaneous "point on three" of the physical game: the progress line shows
 * *how many* have voted but never *for whom*, so nobody can follow a majority
 * that is already forming.
 *
 * That secrecy is exactly what a shared phone would break, so two players on
 * one device vote one after the other behind the same hand-over gate the night
 * uses. The gate shows that a seat has voted - which is public - and never
 * whom it voted for.
 *
 * The round resolves as soon as the last connected player votes, or when the
 * timer runs out - whichever comes first.
 */

import type { ClientState } from "../../../shared/protocol.js";
import type { Actions } from "../../actions.js";
import { UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import {
  banner,
  countdown,
  ghostButton,
  handover,
  header,
  stage,
  tile,
  tileGrid,
} from "../components.js";
import { h } from "../dom.js";

export function renderVote(store: Store, actions: Actions): HTMLElement {
  const state = store.base;
  if (!state) return h("section", { class: "screen" });

  const seat = store.shared ? store.active : state;
  return seat ? renderBallot(store, actions, seat) : renderGate(store, state);
}

/* -------------------------------------------------------------------------- */
/* Shared phone: whose ballot is on screen                                    */
/* -------------------------------------------------------------------------- */

function renderGate(store: Store, state: ClientState): HTMLElement {
  const hasVoted = (seatId: string) =>
    state.players.find((player) => player.id === seatId)?.hasVoted ?? false;
  const progress = state.voteProgress;

  return h(
    "section",
    { class: "screen screen--vote screen--gate" },
    handover({
      title: UI.voteTitle,
      instruction: UI.voteGateInstruction,
      caution: UI.voteInstruction,
      aside: countdown(store),
      seats: store.seats.map((seat) => ({
        label: UI.voteGateButton(store.playerName(seat.youId)),
        note: hasVoted(seat.youId) ? UI.voteSeatDone : UI.voteSeatWaiting,
        onOpen: () => store.openSeat(seat.youId),
      })),
      footer:
        progress && h("p", { class: "muted", text: UI.voteProgress(progress.voted, progress.total) }),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* One player's ballot                                                        */
/* -------------------------------------------------------------------------- */

function renderBallot(store: Store, actions: Actions, seat: ClientState): HTMLElement {
  const myVote = seat.private?.vote;
  const progress = seat.voteProgress;
  const nickname = store.playerName(seat.youId);

  return h(
    "section",
    { class: "screen screen--vote" },
    header({
      title: store.shared ? UI.voteTitleFor(nickname) : UI.voteTitle,
      subtitle: UI.voteInstruction,
      aside: countdown(store),
    }),

    stage(
      tileGrid(
        seat.players.map((player) => {
          // You cannot point at yourself, exactly as in the printed rules.
          const isSelf = player.id === seat.youId;
          return tile({
            label: player.nickname,
            state: isSelf ? "muted" : myVote === player.id ? "selected" : "selectable",
            note: isSelf ? UI.youBadge : player.hasVoted ? "✓" : undefined,
            onClick: isSelf ? undefined : () => actions.castVote(seat.youId, player.id),
          });
        }),
      ),

      myVote && banner(`${UI.voteYours(store.playerName(myVote))} — ${UI.voteChangeable}`, "info"),
      progress && h("p", { class: "muted", text: UI.voteProgress(progress.voted, progress.total) }),
    ),

    store.shared &&
      h("div", { class: "actions" }, ghostButton(UI.handoverDone, () => store.lockSeats())),
  );
}
