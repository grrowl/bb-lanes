// RPC contract between server.ts and app/. The browser imports its type only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { laneBlockSchema, lanesSnapshotSchema, blockDetailSchema } from "./schemas";
export * from "./schemas";

export const rpcContract = defineRpcContract({
  /** Every block overlapping [since, now]. Optionally narrowed to some threads. */
  lanes_window: {
    input: z.object({
      since: z.number(),
      threadIds: z.array(z.string()).max(500).optional(),
    }),
    output: lanesSnapshotSchema,
  },
  /** Lazy tooltip detail for one block. */
  lanes_block_detail: {
    input: z.object({ threadId: z.string(), blockId: z.string() }),
    output: blockDetailSchema,
  },
  /** For each thread, its nearest block before `from` and after `to`. Keyed by thread id; threads with neither are omitted. */
  lanes_neighbors: {
    input: z.object({
      threadIds: z.array(z.string()).min(1).max(500),
      from: z.number(),
      to: z.number(),
    }),
    output: z.object({
      neighbors: z.record(
        z.string(),
        z.object({ prev: laneBlockSchema.nullable(), next: laneBlockSchema.nullable() }),
      ),
    }),
  },
  /** Answer an inline approval from the lanes ("approve" | "reject"). */
  lanes_decide: {
    input: z.object({
      threadId: z.string(),
      interactionId: z.string(),
      decision: z.enum(["approve", "reject"]),
    }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
});
