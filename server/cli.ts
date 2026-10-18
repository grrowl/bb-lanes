import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { LanesService } from "./service";

const usage = "Usage: bb lanes now [--json]\n\nShow running turns and requests waiting for a person.\nOpen the Lanes pane for the live timeline.";
const cell = (value: string, width: number) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, width).padEnd(width);
function elapsed(start: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
export function registerCli(bb: BbPluginApi, lanes: LanesService) {
  bb.cli.register({ name: "lanes", summary: "See running agents and turns that need you",
    commands: [{ name: "now", summary: "Show open turns and requests needing a person", usage: "bb lanes now [--json]" }],
    async run(argv) {
      const args = argv.filter(arg => arg !== "--json");
      if (args.length === 0 || (args.length === 1 && ["help", "--help"].includes(args[0]))) {
        return { exitCode: 0, stdout: usage };
      }
      if (args.length !== 1 || args[0] !== "now") return { exitCode: 1, stderr: usage };
      const open = lanes.storage.open();
      const now = Date.now();
      const needsYou = open.filter(({ block }) => block.status === "waiting").length;
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const names = new Map(projects.map(project => [project.id, project.name]));
      const threads = open.slice(0, 50).map(({ block, thread }) => ({
        threadId: thread.id, title: thread.title || thread.id, project: names.get(thread.projectId ?? "") ?? thread.projectId ?? "",
        status: block.status, elapsedMs: Math.max(0, now - block.start), doing: block.title,
      }));
      const result = { threads, total: open.length, needsYou, indexing: lanes.indexing, generatedAt: now };
      const lines = [
        `${open.length} active · ${needsYou} need you${lanes.indexing ? " · indexing history" : ""}`,
        "", `${cell("THREAD", 32)} ${cell("PROJECT", 20)} ${cell("ELAPSED", 8)} WHAT IT IS DOING`,
        ...threads.map((row, i) => `${cell(row.title, 32)} ${cell(row.project, 20)} ${cell(elapsed(open[i].block.start, now), 8)} ${row.status === "waiting" ? "Needs you · " : ""}${cell(row.doing || "Working", 80).trimEnd()}`),
      ];
      if (!threads.length) lines.push("No agents are running right now.");
      if (open.length > threads.length) lines.push(`Showing ${threads.length} of ${open.length}. Open Lanes to see all threads.`);
      return { exitCode: 0, stdout: argv.includes("--json") ? JSON.stringify(result) : lines.join("\n") };
    },
  });
}
