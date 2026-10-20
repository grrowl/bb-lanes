// Wire schemas shared by the server and browser. Keep SDK runtime imports out.
import { z } from "zod";

const toolKind = z.enum(["command", "edit", "tool", "delegation", "web", "mcp", "skill"]);

export const laneBlockSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  model: z.string().nullable().optional(),
  seq: z.number().nullable().optional(),
  start: z.number(),
  end: z.number().nullable(),
  status: z.enum(["done", "running", "waiting", "failed", "interrupted"]),
  title: z.string(),
  initiator: z.enum(["user", "agent", "system"]),
  initiatorConfirmed: z.boolean().optional(),
  source: z.string(),
  senderThreadId: z.string().nullable(),
  tools: z.array(toolKind),
  counts: z.object({
    commands: z.number(),
    edits: z.number(),
    tools: z.number(),
    delegations: z.number(),
    messages: z.number(),
  }),
  ask: z
    .object({
      interactionId: z.string(),
      kind: z.string(),
      prompt: z.string(),
      canDecideInline: z.boolean(),
    })
    .nullable(),
});

export const laneHandoffSchema = z.object({
  id: z.string(),
  kind: z.enum(["spawn", "fork", "tell", "end"]),
  fromThreadId: z.string(),
  fromBlockId: z.string().nullable(),
  toThreadId: z.string(),
  toBlockId: z.string(),
  at: z.number(),
});

export const lanesSnapshotSchema = z.object({
  generatedAt: z.number(),
  since: z.number(),
  blocks: z.array(laneBlockSchema),
  handoffs: z.array(laneHandoffSchema),
  indexing: z.boolean(),
});

export const blockDetailSchema = z.object({
  blockId: z.string(),
  threadId: z.string(),
  summary: z.array(z.string()),
  prompt: z.string(),
  recent: z.array(z.object({ kind: toolKind, label: z.string() })),
});

