import type { BlockDetail } from "../shared/model";
import { object, string, toolKind, type IndexEvent, type IndexedTurn } from "./indexer";

export function blockDetail(threadId: string, turn: IndexedTurn, events: readonly IndexEvent[]): BlockDetail {
  let finalMessage = "";
  const recent = new Map<string, BlockDetail["recent"][number]>();
  for (const event of events) {
    if (event.scope.turnId !== turn.block.id) continue;
    const item = object(object(event.data).item);
    if (event.type === "item/completed" && item.type === "agentMessage") {
      finalMessage = string(item.text) || string(item.content);
    }
    const kind = toolKind(item);
    if (!kind) continue;
    const label = string(object(item.presentation).title) || string(item.command) || string(item.tool) || string(item.type);
    const id = string(item.id) || `seq:${event.seq}`;
    recent.delete(id);
    recent.set(id, { kind, label: label.slice(0, 180) });
  }
  const plain = finalMessage.replace(/```[\s\S]*?```/g, " ").replace(/^[\s#>*-]+/gm, "").trim();
  const summary = plain.split(/(?<=[.!?])\s+|\n+/u)
    .map(point => point.trim().slice(0, 220)).filter(Boolean).slice(0, 3);
  return { blockId: turn.block.id, threadId, summary, prompt: turn.prompt.slice(0, 600),
    recent: [...recent.values()].slice(-5).reverse() };
}
