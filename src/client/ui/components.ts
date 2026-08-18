/**
 * Reusable pieces of the interface.
 *
 * The card tile is the important one: the same component draws a player during
 * the vote, a center card the Seer may look at, and a revealed face at the end
 * of the round. Having a single tile keeps tap targets and spacing identical
 * across phases, which matters when players are opening their eyes mid-round
 * and need to recognise the screen instantly.
 */

import { formatClock, ROLE_EMOJI, ROLE_NAMES, UI } from "../i18n/fr.js";
import type { RoleId } from "../../shared/roles.js";
import type { Store } from "../store.js";
import { h, type Child } from "./dom.js";

export type TileState = "idle" | "selectable" | "selected" | "revealed" | "muted";

export interface TileOptions {
  /** Main label: a nickname, or "Centre 1". */
  label: string;
  /** Face-up role, when this player is allowed to see it. */
  role?: RoleId;
  /** Small line under the label, e.g. "Vous", "3 voix". */
  note?: string;
  state: TileState;
  /** Struck through and dimmed, for a player eliminated by the vote. */
  eliminated?: boolean;
  onClick?: () => void;
}

export function tile(options: TileOptions): HTMLElement {
  const classes = ["tile", `tile--${options.state}`];
  if (options.eliminated) classes.push("tile--eliminated");
  if (options.role) classes.push("tile--face-up");

  const interactive = Boolean(options.onClick) && options.state !== "muted";

  return h(
    interactive ? "button" : "div",
    {
      class: classes.join(" "),
      attrs: interactive ? { type: "button" } : { role: "group" },
      ...(options.onClick ? { onClick: () => options.onClick?.() } : {}),
    },
    h("span", { class: "tile__glyph", text: options.role ? ROLE_EMOJI[options.role] : "🂠" }),
    h("span", { class: "tile__label", text: options.label }),
    options.role && h("span", { class: "tile__role", text: ROLE_NAMES[options.role] }),
    options.note && h("span", { class: "tile__note", text: options.note }),
  );
}

/** Grid wrapper. Sizing is handled in CSS so it never scrolls on a phone. */
export function tileGrid(...children: (Child | Child[])[]): HTMLElement {
  return h("div", { class: "grid" }, ...children);
}

/**
 * Vertically centred area between the header and the action bar.
 *
 * Phone screens are tall and a round rarely has more than a handful of tiles,
 * so left to itself the content clings to the top and every tap is a stretch.
 * The stage grows to fill whatever is left and centres what it holds.
 */
export function stage(...children: (Child | Child[])[]): HTMLElement {
  return h("div", { class: "stage" }, ...children);
}

/**
 * A countdown that keeps ticking between renders.
 *
 * The element carries `data-countdown`; a single interval in `render.ts`
 * refreshes every such element in the document. That way a full screen rebuild
 * never resets the clock, and there is exactly one timer for the whole app.
 */
export function countdown(store: Store): HTMLElement | null {
  const remaining = store.remainingMs();
  if (remaining === null) return null;
  return h("span", {
    class: "countdown",
    text: formatClock(remaining),
    attrs: { "data-countdown": "", "aria-live": "off" },
  });
}

export interface HeaderOptions {
  title: string;
  subtitle?: string;
  /** Shown on the right; usually the countdown. */
  aside?: Child;
}

export function header(options: HeaderOptions): HTMLElement {
  return h(
    "header",
    { class: "header" },
    h(
      "div",
      { class: "header__text" },
      h("h1", { class: "header__title", text: options.title }),
      options.subtitle && h("p", { class: "header__subtitle", text: options.subtitle }),
    ),
    options.aside && h("div", { class: "header__aside" }, options.aside),
  );
}

export function banner(text: string, kind: "info" | "warn" | "error" = "info"): HTMLElement {
  return h("p", { class: `banner banner--${kind}`, text, attrs: { role: "status" } });
}

export function primaryButton(
  label: string,
  onClick: () => void,
  options: { disabled?: boolean; class?: string } = {},
): HTMLElement {
  return h("button", {
    class: `btn btn--primary ${options.class ?? ""}`.trim(),
    text: label,
    disabled: options.disabled ?? false,
    attrs: { type: "button" },
    onClick,
  });
}

export function ghostButton(label: string, onClick: () => void): HTMLElement {
  return h("button", {
    class: "btn btn--ghost",
    text: label,
    attrs: { type: "button" },
    onClick,
  });
}

export interface StepperOptions {
  label: string;
  /** Already formatted for display, e.g. "5 min". */
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
  disabled?: boolean;
}

/**
 * A -/+ control instead of a number field. Deliberate: the screen rebuilds on
 * every server snapshot, which would steal focus from a real input.
 */
export function stepper(options: StepperOptions): HTMLElement {
  return h(
    "div",
    { class: "stepper" },
    h("span", { class: "stepper__label", text: options.label }),
    h(
      "div",
      { class: "stepper__controls" },
      h("button", {
        class: "btn btn--chip",
        text: "−",
        attrs: { type: "button", "aria-label": `${options.label} −` },
        disabled: options.disabled || !options.canDecrease,
        onClick: options.onDecrease,
      }),
      h("span", { class: "stepper__value", text: options.value }),
      h("button", {
        class: "btn btn--chip",
        text: "+",
        attrs: { type: "button", "aria-label": `${options.label} +` },
        disabled: options.disabled || !options.canIncrease,
        onClick: options.onIncrease,
      }),
    ),
  );
}

export function toggle(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
  disabled = false,
): HTMLElement {
  return h(
    "button",
    {
      class: `toggle ${checked ? "toggle--on" : ""}`.trim(),
      attrs: { type: "button", role: "switch", "aria-checked": checked },
      disabled,
      onClick: () => onChange(!checked),
    },
    h("span", { class: "toggle__label", text: label }),
    h("span", { class: "toggle__track" }, h("span", { class: "toggle__knob" })),
  );
}

/** Room code, rendered large enough to read across a table. */
export function roomCode(code: string): HTMLElement {
  return h(
    "div",
    { class: "room-code" },
    h("span", { class: "room-code__hint", text: UI.shareCode }),
    h("strong", { class: "room-code__value", text: code }),
  );
}

/* -------------------------------------------------------------------------- */
/* Hand-over gate                                                             */
/* -------------------------------------------------------------------------- */

export interface HandoverSeat {
  label: string;
  /** Small line under the label, e.g. "a voté". */
  note?: string;
  onOpen: () => void;
}

export interface HandoverOptions {
  title: string;
  /** Who should be holding the phone, in one sentence. */
  instruction: string;
  /** The reason the screen is still covered, e.g. "personne d'autre ne regarde". */
  caution?: string;
  /** One button per player allowed to take the screen. */
  seats: HandoverSeat[];
  /** Shown between the instruction and the buttons; usually a countdown. */
  aside?: Child;
  footer?: Child;
}

/**
 * The screen that stands between a phone and somebody's secret.
 *
 * Nothing private is rendered until one of these buttons is tapped, which is
 * what makes two players on one device safe: the phase can change, the night
 * can move on, and the most that is ever on screen is a name and an
 * instruction. Every seat gets a button whether or not it has anything to do,
 * so the gate itself never betrays who was called.
 */
export function handover(options: HandoverOptions): HTMLElement {
  return h(
    "div",
    { class: "handover" },
    h("span", { class: "handover__glyph", text: "🤫" }),
    h("h1", { class: "handover__title", text: options.title }),
    h("p", { class: "handover__instruction", text: options.instruction }),
    options.caution && h("p", { class: "handover__caution", text: options.caution }),
    options.aside && h("div", { class: "handover__aside" }, options.aside),
    h(
      "div",
      { class: "handover__seats" },
      options.seats.map((seat) =>
        h(
          "button",
          {
            class: "btn btn--primary btn--block handover__seat",
            attrs: { type: "button" },
            onClick: seat.onOpen,
          },
          h("span", { class: "handover__seat-label", text: seat.label }),
          seat.note && h("span", { class: "handover__seat-note", text: seat.note }),
        ),
      ),
    ),
    options.footer,
  );
}
