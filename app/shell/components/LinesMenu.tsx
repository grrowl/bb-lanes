// The Lines menu: how hand-off lines are drawn, per kind. Every choice is a
// small swatch that previews the whole line with that one change, so a style
// is picked by sight. Choosing keeps the menu open for the next tweak.
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { HandoffKind } from "../../../shared/model";
import {
  DEFAULT_LINE_STYLES,
  type HandoffLineStyle,
  type HandoffLineStyles,
  type LineCap,
  type LineColor,
  type LineStroke,
} from "../../../shared/view";
import { LINE_COLORS, LINE_END_CAPS, LINE_START_CAPS, LINE_STROKES } from "../preferences";

const KINDS: readonly { kind: HandoffKind; label: string; hint: string }[] = [
  { kind: "spawn", label: "Spawned", hint: "One agent starts another" },
  { kind: "tell", label: "Messaged", hint: "One agent messages another" },
];

const STROKE_LABEL: Record<LineStroke, string> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };
const CAP_LABEL: Record<LineCap, string> = { none: "None", dot: "Dot", circle: "Circle", arrow: "Arrow" };
const COLOR_LABEL: Record<LineColor, string> = {
  auto: "Auto, by the target's state",
  neutral: "Neutral",
  blue: "Blue",
  red: "Red",
  amber: "Amber",
  green: "Green",
  violet: "Violet",
};

/** Theme colours for the previews; "auto" is drawn as a running-to-waiting blend. */
const COLOR_VALUE: Record<Exclude<LineColor, "auto">, string> = {
  neutral: "var(--muted-foreground)",
  blue: "var(--timeline-accent)",
  red: "var(--destructive-text)",
  amber: "var(--warning-text)",
  green: "var(--success)",
  violet: "var(--pr-merged)",
};

const DASH: Record<LineStroke, string | undefined> = { solid: undefined, dashed: "4 3", dotted: "0.01 3" };

/** A short line with its caps, stroke, and colour. */
export function LinePreview({
  style,
  width = 30,
  height = 12,
  className,
}: {
  style: HandoffLineStyle;
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradientId = `lanes-line-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const y = height / 2;
  const x1 = 3;
  const x2 = width - 3;
  const paint = style.color === "auto" ? `url(#${gradientId})` : COLOR_VALUE[style.color];
  const lineStart = style.start === "none" ? x1 : x1 + 2.5;
  const lineEnd = style.end === "arrow" ? x2 - 4.5 : style.end === "none" ? x2 : x2 - 2.5;

  const cap = (kind: LineCap, x: number, pointsRight: boolean) => {
    if (kind === "dot") return <circle cx={x} cy={y} r={2.25} fill={paint} />;
    if (kind === "circle") return <circle cx={x} cy={y} r={2} fill="var(--popover)" stroke={paint} strokeWidth={1.25} />;
    if (kind === "arrow") {
      const back = pointsRight ? x - 5 : x + 5;
      return <path d={`M ${x} ${y} L ${back} ${y - 3.25} L ${back} ${y + 3.25} Z`} fill={paint} />;
    }
    return null;
  };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("flex-none", className)} aria-hidden="true">
      {style.color === "auto" ? (
        <defs>
          <linearGradient id={gradientId} x1={x1} y1="0" x2={x2} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--timeline-accent)" />
            <stop offset="1" stopColor="var(--warning-text)" />
          </linearGradient>
        </defs>
      ) : null}
      <line
        x1={lineStart}
        y1={y}
        x2={lineEnd}
        y2={y}
        stroke={paint}
        strokeWidth={1.5}
        strokeLinecap={style.stroke === "dotted" ? "round" : "butt"}
        strokeDasharray={DASH[style.stroke]}
      />
      {cap(style.start, x1 + (style.start === "arrow" ? 0 : 2), false)}
      {cap(style.end, style.end === "arrow" ? x2 : x2 - 2, true)}
    </svg>
  );
}

function sameStyles(a: HandoffLineStyles, b: HandoffLineStyles): boolean {
  return KINDS.every(({ kind }) => {
    const left = a[kind];
    const right = b[kind];
    return left.stroke === right.stroke && left.start === right.start && left.end === right.end && left.color === right.color;
  });
}

function OptionRow<Key extends keyof HandoffLineStyle>({
  kindLabel,
  label,
  property,
  options,
  optionLabel,
  style,
  onChange,
}: {
  kindLabel: string;
  label: string;
  property: Key;
  options: readonly HandoffLineStyle[Key][];
  optionLabel(option: HandoffLineStyle[Key]): string;
  style: HandoffLineStyle;
  onChange(patch: Partial<HandoffLineStyle>): void;
}) {
  return (
    <DropdownMenuGroup aria-label={`${kindLabel} ${label.toLowerCase()}`} className="flex items-center gap-1 px-2 py-0.5">
      <span className="w-12 flex-none text-[11px] leading-4 text-muted-foreground">{label}</span>
      {options.map((option) => {
        const selected = style[property] === option;
        const name = optionLabel(option);
        return (
          <DropdownMenuItem
            key={String(option)}
            role="menuitemradio"
            aria-checked={selected}
            aria-label={`${kindLabel} ${label.toLowerCase()}: ${name}`}
            title={name}
            textValue={name}
            onSelect={(event) => {
              event.preventDefault();
              onChange({ [property]: option } as Partial<HandoffLineStyle>);
            }}
            className={cn(
              "h-7 w-8 flex-none justify-center rounded-md px-0 py-0",
              selected && "bg-state-active ring-1 ring-inset ring-border",
            )}
          >
            <LinePreview style={{ ...style, [property]: option }} width={26} />
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}

export function LinesMenu({
  styles,
  onChange,
  onReset,
  iconOnly = false,
}: {
  styles: HandoffLineStyles;
  onChange(kind: HandoffKind, patch: Partial<HandoffLineStyle>): void;
  onReset(): void;
  /** Narrow toolbars show only the preview. */
  iconOnly?: boolean;
}) {
  const isDefault = sameStyles(styles, DEFAULT_LINE_STYLES);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[12px]" aria-label="Hand-off lines">
          {iconOnly ? null : <span className="text-muted-foreground">Lines</span>}
          <span className="flex flex-col gap-px" aria-hidden="true">
            <LinePreview style={styles.spawn} width={20} height={7} />
            <LinePreview style={styles.tell} width={20} height={7} />
          </span>
          {iconOnly ? null : <Icon name="ChevronDown" className="size-3 text-muted-foreground" aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[19rem]" mobileTitle="Hand-off lines">
        {KINDS.map(({ kind, label, hint }, index) => {
          const style = styles[kind];
          const change = (patch: Partial<HandoffLineStyle>) => onChange(kind, patch);
          return (
            <div key={kind}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="flex items-center gap-2 pt-1.5 pb-1">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold leading-4 text-foreground">{label}</span>
                  <span className="block text-[11px] font-normal leading-4 text-muted-foreground">{hint}</span>
                </span>
                <LinePreview style={style} width={52} />
              </DropdownMenuLabel>
              <OptionRow kindLabel={label} label="Line" property="stroke" options={LINE_STROKES} optionLabel={(option) => STROKE_LABEL[option]} style={style} onChange={change} />
              <OptionRow kindLabel={label} label="Start" property="start" options={LINE_START_CAPS} optionLabel={(option) => CAP_LABEL[option]} style={style} onChange={change} />
              <OptionRow kindLabel={label} label="End" property="end" options={LINE_END_CAPS} optionLabel={(option) => CAP_LABEL[option]} style={style} onChange={change} />
              <OptionRow kindLabel={label} label="Colour" property="color" options={LINE_COLORS} optionLabel={(option) => COLOR_LABEL[option]} style={style} onChange={change} />
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isDefault} onSelect={onReset}>
          <Icon name="RotateCcw" aria-hidden />
          Reset to defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
