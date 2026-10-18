// Small marks drawn like upstream's own: inline SVG on a 12px grid, 1.25px
// strokes with round ends, in currentColor.

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function Chevron({ className = "lanes-chev", collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true" data-collapsed={collapsed ? "" : undefined}>
      <path d="M3 4.5 6 7.5 9 4.5" {...stroke} />
    </svg>
  );
}

export function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5.25" cy="5.25" r="3.5" {...stroke} />
      <path d="m7.9 7.9 2.35 2.35" {...stroke} />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="m3.5 3.5 5 5m0-5-5 5" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}

export function MoreGlyph() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="3" cy="7" r="1.1" fill="currentColor" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" />
      <circle cx="11" cy="7" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function CheckGlyph({ off }: { off?: boolean }) {
  return (
    <svg className="lanes-menu-check" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" data-off={off ? "" : undefined}>
      <path d="m2.75 6.25 2.25 2.25 4.25-4.75" {...stroke} strokeWidth={1.5} />
    </svg>
  );
}
