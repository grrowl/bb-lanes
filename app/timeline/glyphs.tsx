import { memo } from "react";
import type { ToolKind } from "../../shared/model";
import { Icon } from "../../components/ui/icon";

/** bb icon names for each tool family, with a core-set fallback for the lazily loaded ones. */
const TOOL_ICONS: Record<ToolKind, { name: string; fallback: string; label: string }> = {
  command: { name: "Terminal", fallback: "Terminal", label: "Commands" },
  edit: { name: "EditFile", fallback: "Edit", label: "Edits" },
  tool: { name: "ToolCase", fallback: "Toolbox", label: "Tools" },
  delegation: { name: "Bot", fallback: "Bot", label: "Delegation" },
  web: { name: "Globe", fallback: "Search", label: "Web" },
  mcp: { name: "Plug02", fallback: "ToolCase", label: "MCP" },
  skill: { name: "Zap", fallback: "Zap", label: "Skills" },
};

export function toolLabel(kind: ToolKind): string {
  return TOOL_ICONS[kind].label;
}

export const ToolGlyph = memo(function ToolGlyph({ kind, className }: { kind: ToolKind; className?: string }) {
  const icon = TOOL_ICONS[kind];
  return <Icon name={icon.name} fallback={icon.fallback} className={className ?? "bl-glyph"} aria-hidden />;
});
