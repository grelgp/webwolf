/**
 * Lobby: who is at the table, what is in the deck, and the round settings.
 *
 * Only the host can change anything; everyone else sees the same information
 * read-only, which matters because the deck is public knowledge in this game -
 * knowing that exactly one Robber is in play is half of the deduction.
 */

import {
  NUMERIC_SETTING_KEYS,
  SETTINGS_BOUNDS,
  type NumericSettingKey,
  type RoomSettings,
} from "../../../shared/constants.js";
import { deckToCounts, requiredDeckSize, validateDeck } from "../../../shared/deck.js";
import { ROLES, ROLE_ORDER, type RoleId } from "../../../shared/roles.js";
import type { ClientState } from "../../../shared/protocol.js";
import type { Actions } from "../../actions.js";
import { deckProblem, formatDuration, ROLE_EMOJI, ROLE_NAMES_PLURAL, UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import {
  banner,
  ghostButton,
  header,
  primaryButton,
  roomCode,
  stepper,
  toggle,
} from "../components.js";
import { h } from "../dom.js";

const SETTING_LABELS: Record<NumericSettingKey, string> = {
  roleRevealSeconds: UI.settingRoleReveal,
  nightStepSeconds: UI.settingNightStep,
  discussionSeconds: UI.settingDiscussion,
  voteSeconds: UI.settingVote,
};

export function renderLobby(store: Store, actions: Actions): HTMLElement {
  const state = store.state.server;
  if (!state) return h("section", { class: "screen" });

  const isHost = state.isHost;
  const counts = deckToCounts(state.deck);
  const required = requiredDeckSize(state.players.length);
  const validation = validateDeck(state.deck, state.players.length);

  return h(
    "section",
    { class: "screen screen--lobby" },
    header({ title: UI.lobbyTitle, aside: roomCode(state.code) }),

    store.state.error && banner(store.state.error, "error"),

    playerList(state, store, actions, isHost),
    deckBuilder(state, counts, required, isHost, actions),
    validation.ok
      ? null
      : banner(deckProblem(validation.reason, validation.detail), "warn"),
    settingsPanel(state.settings, isHost, actions),

    h(
      "div",
      { class: "actions" },
      isHost
        ? primaryButton(UI.startGame, () => actions.startGame(), {
            disabled: !validation.ok,
            class: "btn--block",
          })
        : banner(UI.waitingForHost, "info"),
      ghostButton(UI.leaveRoom, () => actions.leaveRoom()),
    ),
  );
}

function playerList(
  state: ClientState,
  store: Store,
  actions: Actions,
  isHost: boolean,
): HTMLElement {
  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel__title", text: UI.playersTitle(state.players.length) }),
    h(
      "ul",
      { class: "player-list" },
      state.players.map((player) =>
        h(
          "li",
          { class: `player ${player.connected ? "" : "player--offline"}`.trim() },
          h("span", { class: "player__name", text: player.nickname }),
          player.isHost && h("span", { class: "chip chip--host", text: UI.hostBadge }),
          player.id === state.youId && h("span", { class: "chip", text: UI.youBadge }),
          !player.connected && h("span", { class: "chip chip--muted", text: UI.disconnectedBadge }),
          isHost &&
            player.id !== state.youId &&
            h("button", {
              class: "player__remove",
              text: "✕",
              attrs: { type: "button", "aria-label": `${UI.removePlayer} ${player.nickname}` },
              onClick: () => actions.kickPlayer(player.id),
            }),
        ),
      ),
    ),
  );
}

function deckBuilder(
  state: ClientState,
  counts: Record<RoleId, number>,
  required: number,
  isHost: boolean,
  actions: Actions,
): HTMLElement {
  const total = state.deck.length;

  const change = (roleId: RoleId, delta: number) => {
    const next = { ...counts, [roleId]: Math.max(0, counts[roleId] + delta) };
    actions.setDeck(next);
  };

  return h(
    "div",
    { class: "panel" },
    h(
      "div",
      { class: "panel__head" },
      h("h2", { class: "panel__title", text: UI.deckTitle }),
      h("span", {
        class: `pill ${total === required ? "pill--ok" : "pill--warn"}`,
        text: UI.deckCount(total, required),
      }),
    ),
    h("p", { class: "panel__hint", text: UI.deckHint(state.players.length) }),
    h(
      "div",
      { class: "deck" },
      ROLE_ORDER.map((roleId) =>
        h(
          "div",
          { class: `deck__row ${counts[roleId] > 0 ? "deck__row--active" : ""}`.trim() },
          h("span", { class: "deck__glyph", text: ROLE_EMOJI[roleId] }),
          h("span", { class: "deck__name", text: ROLE_NAMES_PLURAL[roleId] }),
          h(
            "div",
            { class: "deck__controls" },
            h("button", {
              class: "btn btn--chip",
              text: "−",
              attrs: { type: "button", "aria-label": `${ROLE_NAMES_PLURAL[roleId]} −` },
              disabled: !isHost || counts[roleId] === 0,
              onClick: () => change(roleId, -1),
            }),
            h("span", { class: "deck__count", text: String(counts[roleId]) }),
            h("button", {
              class: "btn btn--chip",
              text: "+",
              attrs: { type: "button", "aria-label": `${ROLE_NAMES_PLURAL[roleId]} +` },
              disabled: !isHost || counts[roleId] >= ROLES[roleId].maxCopies,
              onClick: () => change(roleId, +1),
            }),
          ),
        ),
      ),
    ),
  );
}

function settingsPanel(
  settings: RoomSettings,
  isHost: boolean,
  actions: Actions,
): HTMLElement {
  const bump = (key: NumericSettingKey, direction: 1 | -1) => {
    const bounds = SETTINGS_BOUNDS[key];
    const next = settings[key] + direction * bounds.step;
    actions.setSettings({ [key]: Math.min(bounds.max, Math.max(bounds.min, next)) });
  };

  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel__title", text: UI.settingsTitle }),
    NUMERIC_SETTING_KEYS.map((key) => {
      const bounds = SETTINGS_BOUNDS[key];
      return stepper({
        label: SETTING_LABELS[key],
        value: formatDuration(settings[key]),
        canDecrease: settings[key] > bounds.min,
        canIncrease: settings[key] < bounds.max,
        disabled: !isHost,
        onDecrease: () => bump(key, -1),
        onIncrease: () => bump(key, +1),
      });
    }),

    // Narration is a host-device concern: it is the only phone that speaks.
    isHost &&
      h(
        "div",
        { class: "panel__section" },
        toggle(UI.settingNarration, settings.narrationEnabled, (next) =>
          actions.setSettings({ narrationEnabled: next }),
        ),
        h("p", { class: "panel__hint", text: UI.narrationHint }),
        ghostButton(UI.testVoice, () => actions.testVoice()),
      ),
  );
}
