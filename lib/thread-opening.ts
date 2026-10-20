export function threadSplit(openBeside: boolean, event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey ? !openBeside : openBeside;
}

export function openModifier(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
