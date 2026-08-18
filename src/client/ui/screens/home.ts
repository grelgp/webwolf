/**
 * Entry screen: pick a nickname, then create a room or join one by code.
 *
 * This is the only screen with free-text inputs. Because the app rebuilds a
 * screen whenever state changes, the two field values are held in module
 * scope and written back on every render - otherwise a reconnect banner
 * appearing mid-typing would wipe what the player had entered.
 */

import { ROOM_CODE_LENGTH } from "../../../shared/constants.js";
import type { Actions } from "../../actions.js";
import { UI } from "../../i18n/fr.js";
import type { Store } from "../../store.js";
import { banner, ghostButton, primaryButton } from "../components.js";
import { h } from "../dom.js";

const draft = { nickname: "", code: "" };

export function renderHome(store: Store, actions: Actions): HTMLElement {
  if (!draft.nickname) draft.nickname = store.state.nickname;

  const nicknameInput = h("input", {
    class: "field__input",
    attrs: {
      type: "text",
      id: "nickname",
      placeholder: UI.nicknamePlaceholder,
      maxlength: 16,
      autocomplete: "nickname",
      enterkeyhint: "done",
    },
    onInput: (event) => {
      draft.nickname = (event.target as HTMLInputElement).value;
    },
  }) as HTMLInputElement;
  nicknameInput.value = draft.nickname;

  const codeInput = h("input", {
    class: "field__input field__input--code",
    attrs: {
      type: "text",
      id: "room-code",
      placeholder: UI.codePlaceholder,
      maxlength: ROOM_CODE_LENGTH,
      autocapitalize: "characters",
      autocomplete: "off",
      // Room codes are letters only, but `inputmode="text"` keeps the mobile
      // keyboard on its letter layout instead of guessing.
      inputmode: "text",
      enterkeyhint: "go",
    },
    onInput: (event) => {
      const input = event.target as HTMLInputElement;
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
      draft.code = input.value;
    },
  }) as HTMLInputElement;
  codeInput.value = draft.code;

  const nickname = () => nicknameInput.value.trim();

  const create = () => {
    if (!nickname()) {
      nicknameInput.focus();
      return;
    }
    actions.createRoom(nickname());
  };

  const join = () => {
    if (!nickname()) {
      nicknameInput.focus();
      return;
    }
    if (codeInput.value.length !== ROOM_CODE_LENGTH) {
      codeInput.focus();
      return;
    }
    actions.joinRoom(codeInput.value, nickname());
  };

  const connecting = store.state.status !== "open";

  return h(
    "section",
    { class: "screen screen--home" },
    h(
      "div",
      { class: "home__brand" },
      h("span", { class: "home__logo", text: "🐺" }),
      h("h1", { class: "home__title", text: UI.appName }),
      h("p", { class: "home__tagline", text: UI.tagline }),
    ),

    store.state.error && banner(store.state.error, "error"),
    connecting && banner(store.state.status === "closed" ? UI.offline : UI.connecting, "warn"),

    h(
      "div",
      { class: "home__form" },
      h(
        "label",
        { class: "field" },
        h("span", { class: "field__label", text: UI.nicknameLabel }),
        nicknameInput,
      ),

      primaryButton(UI.createRoom, create, { disabled: connecting, class: "btn--block" }),

      h("div", { class: "home__divider" }, h("span", { text: "ou" })),

      h(
        "div",
        { class: "home__join" },
        h(
          "label",
          { class: "field field--grow" },
          h("span", { class: "field__label", text: UI.codeLabel }),
          codeInput,
        ),
        ghostButton(UI.joinRoom, join),
      ),
    ),
  );
}

/** Called after leaving a room so the next visit starts from a clean form. */
export function resetHomeDraft(): void {
  draft.code = "";
}

/**
 * Pre-fills the join field, so a link shared as `https://host/ABCD` drops the
 * player straight onto a form that only needs a nickname.
 */
export function presetJoinCode(code: string): void {
  draft.code = code.toUpperCase();
}
