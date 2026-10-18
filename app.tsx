// Lanes: where every agent is right now. A live timeline with one lane per
// bb thread, one block per agent turn growing into "now", hand-offs drawn
// between threads, and approvals answered on the block.
//
// app/shell/** owns registration, data, grouping, and chrome; the timeline
// engine draws the lanes themselves.
import type { ComponentType } from "react";
import { definePluginApp, type PluginNavPanelProps, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { TimelineProps } from "./shared/view";
import { LanesHeaderContent, LanesSidebarAccessory } from "./app/shell/components/HeaderContent";
import { LanesIcon, LANES_ICON_NAME } from "./app/shell/components/LanesIcon";
import { LanesPane } from "./app/shell/LanesPane";
import { TeamLanesPanel } from "./app/shell/TeamLanesPanel";
import { StandInTimeline } from "./app/shell/dev/StandInTimeline";

const Timeline: ComponentType<TimelineProps> = StandInTimeline;

function LanesPage(_props: PluginNavPanelProps) {
  return <LanesPane surface="lanes" Timeline={Timeline} />;
}

function TeamLanesTab(props: PluginThreadPanelProps) {
  return <TeamLanesPanel {...props} Timeline={Timeline} />;
}

function HeaderContent(_props: PluginNavPanelProps) {
  return (
    <div data-lanes-header="">
      <LanesHeaderContent />
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: LANES_ICON_NAME, component: LanesIcon });
  app.slots.navPanel({
    id: "lanes",
    title: "Lanes",
    icon: LANES_ICON_NAME,
    path: "lanes",
    component: LanesPage,
    headerContent: HeaderContent,
    experimental_sidebarAccessory: LanesSidebarAccessory,
  });
  app.slots.threadPanelAction({
    id: "team-lanes",
    title: "Team lanes",
    icon: LANES_ICON_NAME,
    layout: "flush",
    component: TeamLanesTab,
  });
});
