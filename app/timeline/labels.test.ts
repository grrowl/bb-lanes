import { describe, expect, it } from "vitest";
import type { LaneBlock, LaneHandoff } from "../../shared/model";
import { blockTitle, withReportTitles } from "./labels";

const describeThread = (id: string) => ({ title: { lead: "Coordinate the build", a: "Backend indexer", b: "Timeline engine" }[id] ?? id, subtitle: null });

function block(id: string, overrides: Partial<LaneBlock> = {}): LaneBlock {
  return {
    id,
    threadId: "lead",
    start: 0,
    end: null,
    status: "running",
    title: "",
    initiator: "system",
    source: "send",
    senderThreadId: null,
    tools: [],
    counts: { commands: 0, edits: 0, tools: 0, delegations: 0, messages: 0 },
    ask: null,
    ...overrides,
  };
}

const ended = (from: string, toBlock: string): LaneHandoff => ({
  id: `${from}>${toBlock}`,
  kind: "end",
  fromThreadId: from,
  fromBlockId: null,
  toThreadId: "lead",
  toBlockId: toBlock,
  at: 0,
});

describe("block titles", () => {
  it("names a parent's turn after the child that reported into it", () => {
    const [report] = withReportTitles([block("t1")], [ended("a", "t1")], describeThread);
    expect(report!.title).toBe("Report from Backend indexer");
  });

  it("counts the children when several reported into one turn", () => {
    const [report] = withReportTitles([block("t1")], [ended("a", "t1"), ended("b", "t1"), ended("a", "t1")], describeThread);
    expect(report!.title).toBe("Reports from 2 threads");
  });

  it("keeps a turn's own words and leaves other blocks untouched", () => {
    const own = block("t1", { title: "Merge the backend" });
    const other = block("t2");
    const out = withReportTitles([own, other], [ended("a", "t1")], describeThread);
    expect(out[0]).toBe(own);
    expect(out[1]).toBe(other);
  });

  it("calls any other untitled bb turn an update from bb", () => {
    expect(blockTitle(block("t1"), describeThread)).toBe("Update from bb");
  });
});
