/** The reference's "needs you" triangle. */
export function WaitingGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="9" height="9" className={className} aria-hidden="true">
      <path d="M6 1.8 10.8 10H1.2L6 1.8Z" fill="currentColor" />
    </svg>
  );
}
