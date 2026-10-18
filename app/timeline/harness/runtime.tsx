// A stand-in for the bb plugin runtime, so the engine's and the shell's
// `@get-bb/plugin-sdk/app` imports work outside bb: `experimental_Icon` draws
// the same Hugeicons glyphs bb resolves these names to, `ThreadTitle` and
// `experimental_ProviderIcon` draw the fixture's titles and marks, and splits
// are always available.
import * as React from "react";
import type { CSSProperties } from "react";
import { ProviderLogo, type LogoProvider } from "./logos";

type Glyph = [tag: "path" | "circle" | "ellipse", attrs: Record<string, string>][];

const s = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "1.5" };

const GLYPHS: Record<string, Glyph> = {
  Terminal: [
    ["path", { d: "M7.5 7.5L8.72654 8.55719C9.24218 9.00163 9.5 9.22386 9.5 9.5C9.5 9.77614 9.24218 9.99836 8.72654 10.4428L7.5 11.5", ...s }],
    ["path", { d: "M11.5 12.5H15.5", ...s }],
    ["path", { d: "M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95491C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95491 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.7367 5.06107 20.0451C6.3754 21 8.25027 21 12 21Z", ...s }],
  ],
  EditFile: [
    ["path", { d: "M8.17151 19.8284L19.8284 8.17157C20.3736 7.62632 20.6462 7.3537 20.792 7.0596C21.0693 6.50005 21.0693 5.8431 20.792 5.28354C20.6462 4.98945 20.3736 4.71682 19.8284 4.17157C19.2831 3.62632 19.0105 3.3537 18.7164 3.20796C18.1568 2.93068 17.4999 2.93068 16.9403 3.20796C16.6462 3.3537 16.3736 3.62632 15.8284 4.17157L4.17151 15.8284C3.59345 16.4064 3.30442 16.6955 3.15218 17.063C2.99994 17.4305 2.99994 17.8393 2.99994 18.6568V20.9999H5.34308C6.16059 20.9999 6.56934 20.9999 6.93688 20.8477C7.30442 20.6955 7.59345 20.4064 8.17151 19.8284Z", ...s }],
    ["path", { d: "M12 21H18", ...s }],
    ["path", { d: "M14.5 5.5L18.5 9.5", ...s }],
  ],
  ToolCase: [
    ["path", { d: "M20.0004 10.9826C20.6281 10.1316 21 9.07385 21 7.92761C21 5.11556 18.7614 2.83594 16 2.83594C14.0209 2.83594 12.3104 4.00687 11.5 5.70554", ...s }],
    ["path", { d: "M14.6364 21.1658H9.36364C6.67794 21.1658 5.33509 21.1658 4.40253 20.4549C4.13533 20.2512 3.89812 20.0096 3.69811 19.7375C3 18.7879 3 17.4204 3 14.6855C3 13.1226 3 12.3412 3.39892 11.7986C3.51321 11.6431 3.64876 11.505 3.80144 11.3887C4.33434 10.9824 5.10168 10.9824 6.63636 10.9824H17.3636C18.8983 10.9824 19.6657 10.9824 20.1986 11.3887C20.3512 11.505 20.4868 11.6431 20.6011 11.7986C21 12.3412 21 13.1226 21 14.6855C21 17.4204 21 18.7879 20.3019 19.7375C20.1019 20.0096 19.8647 20.2512 19.5975 20.4549C18.6649 21.1658 17.3221 21.1658 14.6364 21.1658Z", ...s }],
    ["path", { d: "M10 15.0547H14", ...s }],
  ],
  Bot: [
    ["path", { d: "M13 7H11C8.19108 7 6.78661 7 5.77772 7.67412C5.34096 7.96596 4.96596 8.34096 4.67412 8.77772C4 9.78661 4 11.1911 4 14C4 16.8089 4 18.2134 4.67412 19.2223C4.96596 19.659 5.34096 20.034 5.77772 20.3259C6.78661 21 8.19108 21 11 21H13C15.8089 21 17.2134 21 18.2223 20.3259C18.659 20.034 19.034 19.659 19.3259 19.2223C20 18.2134 20 16.8089 20 14C20 11.1911 20 9.78661 19.3259 8.77772C19.034 8.34096 18.659 7.96596 18.2223 7.67412C17.2134 7 15.8089 7 13 7Z", ...s }],
    ["path", { d: "M4 14H2", ...s }],
    ["path", { d: "M10 17H14", ...s }],
    ["path", { d: "M22 14H20", ...s }],
    ["path", { d: "M15 11V13", ...s }],
    ["path", { d: "M9 11V13", ...s }],
    ["path", { d: "M12 7C12 5.11438 12 4.17157 11.4142 3.58579C10.8284 3 9.88562 3 8 3", ...s }],
  ],
  Globe: [
    ["circle", { cx: "12", cy: "12", r: "10", ...s }],
    ["ellipse", { cx: "12", cy: "12", rx: "4", ry: "10", ...s }],
    ["path", { d: "M2 12H22", ...s }],
  ],
  Plug02: [
    ["path", { d: "M14 8V11M10 11V8", ...s }],
    ["path", { d: "M8.00297 12.0267C7.95812 11.4726 8.42638 11 9.02009 11H14.9799C15.5736 11 16.0419 11.4726 15.997 12.0267L15.8745 13.5403C15.7864 14.6285 15.4008 15.6771 14.7546 16.5856L14.3541 17.1487C13.9759 17.6805 13.3385 18 12.6558 18H11.3442C10.6615 18 10.0241 17.6805 9.64588 17.1487L9.24535 16.5856C8.59923 15.6771 8.2136 14.6285 8.12551 13.5403L8.00297 12.0267Z", ...s }],
    ["path", { d: "M16 21.2109C19.5318 19.6644 22 16.1323 22 12.0224C22 6.4872 17.5228 2 12 2C6.47715 2 2 6.4872 2 12.0224C2 17.2199 5.94741 21.4933 11.0014 21.9955C11.551 22.0501 12 21.5962 12 21.0426V18.0359", ...s }],
  ],
  Zap: [
    ["path", { d: "M8.62814 12.6736H8.16918C6.68545 12.6736 5.94358 12.6736 5.62736 12.1844C5.31114 11.6953 5.61244 11.0138 6.21504 9.65083L8.02668 5.55323C8.57457 4.314 8.84852 3.69438 9.37997 3.34719C9.91142 3 10.5859 3 11.935 3H14.0244C15.6632 3 16.4826 3 16.7916 3.53535C17.1007 4.0707 16.6942 4.78588 15.8811 6.21623L14.8092 8.10188C14.405 8.81295 14.2029 9.16849 14.2057 9.45952C14.2094 9.83775 14.4105 10.1862 14.7354 10.377C14.9854 10.5239 15.3927 10.5239 16.2074 10.5239C17.2373 10.5239 17.7523 10.5239 18.0205 10.7022C18.3689 10.9338 18.5513 11.3482 18.4874 11.7632C18.4382 12.0826 18.0918 12.4656 17.399 13.2317L11.8639 19.3523C10.7767 20.5545 10.2331 21.1556 9.86807 20.9654C9.50303 20.7751 9.67833 19.9822 10.0289 18.3962L10.7157 15.2896C10.9826 14.082 11.1161 13.4782 10.7951 13.0759C10.4741 12.6736 9.85877 12.6736 8.62814 12.6736Z", ...s }],
  ],
  ChevronDown: [["path", { d: "M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9", ...s }]],
  Folder: [["path", { d: "M3 7.5C3 6.12 4.12 5 5.5 5H9l2 2h7.5C19.88 7 21 8.12 21 9.5v7c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 19 3 17.88 3 16.5v-9Z", ...s }]],
};

interface IconProps {
  name: string;
  fallback?: string;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

function HarnessIcon({ name, fallback = "Zap", className, style, ...aria }: IconProps) {
  const glyph = GLYPHS[name] ?? GLYPHS[fallback] ?? GLYPHS.Zap!;
  return (
    <svg viewBox="0 0 24 24" fill="none" width="24" height="24" className={className} style={style} {...aria}>
      {glyph.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

const titles = new Map<string, string>();

/** The titles `ThreadTitle` draws, by thread id. */
export function setHarnessTitles(next: Iterable<[string, string]>): void {
  titles.clear();
  for (const [id, title] of next) titles.set(id, title);
}

function HarnessThreadTitle({ threadId }: { threadId: string }) {
  return <>{titles.get(threadId) ?? threadId}</>;
}

function HarnessProviderIcon({ provider }: { provider: { id: string } }) {
  return <ProviderLogo provider={provider.id as LogoProvider} />;
}

const split = { isAvailable: true, splitProps: {} };

export function installHarnessRuntime(): void {
  (globalThis as { __bbPluginRuntime?: unknown }).__bbPluginRuntime = {
    react: React,
    pluginSdkApp: {
      experimental_Icon: HarnessIcon,
      experimental_ProviderIcon: HarnessProviderIcon,
      experimental_useSidebarThreadSplit: () => split,
      ThreadTitle: HarnessThreadTitle,
    },
  };
}
