// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePaneShortcuts } from "./use-pane-shortcuts";

function Pane({ name, handle }: { name: string; handle: (event: KeyboardEvent) => boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePaneShortcuts(ref, handle);
  return <div ref={ref} data-lanes-shortcuts={name} data-testid={name}>
    <button>{name}</button>
    <div role="menu"><button>{name} menu</button></div>
    <div contentEditable suppressContentEditableWarning><span data-testid={`${name}-editor`}>Typing</span></div>
  </div>;
}

beforeEach(() => vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("routes keys to the focused pane, and follows a click on empty space when focus is on the body", () => {
  const one = vi.fn(() => true);
  const two = vi.fn(() => true);
  render(<><Pane name="one" handle={one} /><Pane name="two" handle={two} /></>);
  const button = screen.getByRole("button", { name: "two" });
  button.focus();
  fireEvent.keyDown(button, { key: "n" });
  expect(one).not.toHaveBeenCalled();
  expect(two).toHaveBeenCalledTimes(1);
  button.blur();
  fireEvent.pointerDown(screen.getByTestId("one"));
  fireEvent.keyDown(document.body, { key: "n" });
  expect(one).toHaveBeenCalledTimes(1);
  expect(two).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(document.body);
  fireEvent.keyDown(document.body, { key: "n" });
  expect(one).toHaveBeenCalledTimes(1);
  expect(two).toHaveBeenCalledTimes(1);
});

it("leaves overlays, nested editors, composing text and modified keys alone", () => {
  const handle = vi.fn(() => true);
  render(<Pane name="one" handle={handle} />);
  const menu = screen.getByRole("button", { name: "one menu" });
  menu.focus();
  fireEvent.keyDown(menu, { key: "n" });
  fireEvent.keyDown(screen.getByTestId("one-editor"), { key: "n" });
  const button = screen.getByRole("button", { name: "one" });
  button.focus();
  fireEvent.keyDown(button, { key: "n", isComposing: true });
  for (const modifier of ["altKey", "ctrlKey", "metaKey"]) fireEvent.keyDown(button, { key: "n", [modifier]: true });
  expect(handle).not.toHaveBeenCalled();
});

it("claims handled keys before host shortcuts and lets unhandled keys through", () => {
  render(<Pane name="one" handle={(event) => event.key === "n"} />);
  const host = vi.fn();
  document.addEventListener("keydown", host);
  try {
    const button = screen.getByRole("button", { name: "one" });
    button.focus();
    expect(fireEvent.keyDown(button, { key: "n" })).toBe(false);
    expect(host).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(button, { key: "ArrowDown" })).toBe(true);
    expect(host).toHaveBeenCalledTimes(1);
  } finally { document.removeEventListener("keydown", host); }
});

it("keeps the owning pane's shortcuts after choosing an item in a portalled menu", () => {
  const one = vi.fn(() => true);
  const two = vi.fn(() => true);
  render(<><Pane name="one" handle={one} /><Pane name="two" handle={two} /></>);
  const trigger = screen.getByRole("button", { name: "two" });
  trigger.id = "window-trigger";
  trigger.setAttribute("aria-controls", "window-menu");
  const menu = document.createElement("div");
  menu.id = "window-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-labelledby", trigger.id);
  document.body.append(menu);
  fireEvent.pointerDown(menu);
  menu.remove();
  fireEvent.keyDown(document.body, { key: "n" });
  expect(one).not.toHaveBeenCalled();
  expect(two).toHaveBeenCalledTimes(1);
});
