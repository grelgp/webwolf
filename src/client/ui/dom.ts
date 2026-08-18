/**
 * A ~60 line hyperscript helper, in place of a UI framework.
 *
 * The client re-renders the whole screen on every server snapshot. That is
 * affordable here (a table is at most ten players) and it removes a whole
 * class of bugs where stale secret information lingers in the DOM after a
 * phase ends - which, in this game, is the bug that matters most.
 *
 * The one constraint it imposes: no free-text input inside a re-rendered
 * screen, since a rebuild would drop focus. The lobby therefore uses steppers
 * and toggles, and the only text fields live on the home screen, which never
 * re-renders from server state.
 */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  disabled?: boolean;
  hidden?: boolean;
  /** Applied verbatim; use for aria-*, data-*, type, inputmode, ... */
  attrs?: Record<string, string | number | boolean | undefined>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onSubmit?: (event: SubmitEvent) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.hidden) node.hidden = true;
  if (props.disabled !== undefined && "disabled" in node) {
    (node as HTMLElement & { disabled: boolean }).disabled = props.disabled;
  }

  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }

  if (props.onClick) node.addEventListener("click", props.onClick as EventListener);
  if (props.onInput) node.addEventListener("input", props.onInput);
  if (props.onSubmit) node.addEventListener("submit", props.onSubmit as EventListener);

  append(node, children);
  return node;
}

function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child === null || child === undefined || child === false) {
      // Skip, so callers can write `condition && h(...)` inline.
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Replaces every child of `parent` in one go. */
export function mount(parent: HTMLElement, ...children: (Child | Child[])[]): void {
  parent.replaceChildren();
  append(parent, children);
}
