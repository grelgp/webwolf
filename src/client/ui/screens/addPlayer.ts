/**
 * Seating a second player on this phone.
 *
 * A full screen rather than a field in the lobby, for the same reason the home
 * screen is one: the lobby rebuilds itself on every server snapshot, and a
 * player joining mid-sentence would steal focus from a text input. Here the
 * only thing that can force a rebuild is somebody else's arrival, and the
 * draft is held in module scope so the typed value survives it either way.
 */

import { NICKNAME_MAX_LENGTH } from "../../../shared/constants.js";
import type { Actions } from "../../actions.js";
import { UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { banner, ghostButton, header, primaryButton } from "../components.js";
import { h } from "../dom.js";

const draft = { nickname: "" };
/** Set when the screen opens, so focus is claimed once and not on every render. */
let wantsFocus = false;

/** Called from the lobby, just before the screen is shown. */
export function openAddPlayer(store: Store): void {
  draft.nickname = "";
  wantsFocus = true;
  store.setAddingPlayer(true);
}

export function renderAddPlayer(store: Store, actions: Actions): HTMLElement {
  const nicknameInput = h("input", {
    class: "field__input",
    attrs: {
      type: "text",
      id: "companion-nickname",
      placeholder: UI.nicknamePlaceholder,
      maxlength: NICKNAME_MAX_LENGTH,
      autocomplete: "off",
      enterkeyhint: "done",
    },
    onInput: (event) => {
      draft.nickname = (event.target as HTMLInputElement).value;
    },
  }) as HTMLInputElement;
  nicknameInput.value = draft.nickname;

  if (wantsFocus) {
    wantsFocus = false;
    // The node is not in the document yet; focus it once it is mounted.
    queueMicrotask(() => nicknameInput.focus());
  }

  const confirm = () => {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      nicknameInput.focus();
      return;
    }
    actions.addPlayer(nickname);
  };

  return h(
    "section",
    { class: "screen screen--add-player" },
    header({ title: UI.addPlayerTitle }),

    store.state.error && banner(store.state.error, "error"),
    banner(UI.addPlayerIntro, "info"),

    h(
      "div",
      { class: "home__form" },
      h(
        "label",
        { class: "field" },
        h("span", { class: "field__label", text: UI.addPlayerLabel }),
        nicknameInput,
      ),
      primaryButton(UI.addPlayerConfirm, confirm, { class: "btn--block" }),
      ghostButton(UI.cancel, () => store.setAddingPlayer(false)),
    ),
  );
}
