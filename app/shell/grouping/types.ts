import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { BlockStatus } from "../../../shared/model";
import type { LaneRow, Row } from "../../../shared/view";

export type GroupMode =
  | "project"
  | "section"
  | "environment"
  | "machine"
  | "provider"
  | "team"
  | "none";

export const GROUP_MODES: readonly { id: GroupMode; label: string; icon: string }[] = [
  { id: "project", label: "Project", icon: "Folder" },
  { id: "section", label: "Section", icon: "Layers" },
  { id: "environment", label: "Environment", icon: "GitBranch" },
  { id: "machine", label: "Machine", icon: "Laptop" },
  { id: "provider", label: "Provider", icon: "Bot" },
  { id: "team", label: "Team", icon: "Workflow" },
  { id: "none", label: "None", icon: "ListView" },
];

export type LaneFilter = "all" | "active" | "needs-you" | "failed";

export const LANE_FILTERS: readonly { id: LaneFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "needs-you", label: "Needs you" },
  { id: "failed", label: "Failed" },
];

export type LaneState = LaneRow["state"];

/** What the turn history says about one thread, folded from its blocks. */
export interface ThreadActivity {
  /** Latest moment the thread did anything we know of (block start or end). */
  lastActivityAt: number;
  /** Has a block overlapping the activity window. */
  inWindow: boolean;
  /** Status of the open block, if the thread has one. */
  openStatus: "running" | "waiting" | null;
  /** Status of the most recently started block. */
  lastStatus: BlockStatus | null;
  /** Model of the most recent block that reported one. */
  model: string | null;
}

export interface ProviderSummary {
  id: string;
  displayName: string;
}

export interface OrganizeInput {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  sections: readonly PluginSidebarSection[];
  /** Known machines in the sidebar's order. */
  hosts: readonly { id: string; name: string }[];
  /** Agent providers in picker order. */
  providers: readonly ProviderSummary[];
  activity: ReadonlyMap<string, ThreadActivity>;
  mode: GroupMode;
  filter: LaneFilter;
  query: string;
  collapsedGroups: ReadonlySet<string>;
  collapsedLanes: ReadonlySet<string>;
}

export type GroupKind =
  | "pinned"
  | "project"
  | "threads"
  | "section"
  | "environment"
  | "machine"
  | "provider"
  | "team"
  | "solo";

/** Presentation facts about a group that the shared `GroupRow` does not carry. */
export interface GroupMeta {
  id: string;
  kind: GroupKind;
  label: string;
  /** Muted text after the label, e.g. the project an environment belongs to. */
  detail: string | null;
  icon: string;
  /** Set for provider groups so the header can draw the provider's logo. */
  providerId: string | null;
}

/** Per-lane presentation facts the shared `LaneRow` does not carry. */
export interface LaneMeta {
  /**
   * One entry per ancestor level, outermost first: true where that ancestor
   * has later siblings, so a vertical tree guide continues through this row.
   */
  guides: readonly boolean[];
  /** False for a lane shown only as context for a matching descendant. */
  matched: boolean;
}

export interface Organized {
  rows: Row[];
  groups: ReadonlyMap<string, GroupMeta>;
  lanes: ReadonlyMap<string, LaneMeta>;
  /** Lanes that pass the filter and search (context ancestors excluded). */
  matchCount: number;
}
