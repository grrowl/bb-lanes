import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** A small tooltip naming a control and its key. */
export function Hint({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          {label}
          {shortcut !== undefined ? (
            <kbd className="rounded border border-primary-foreground/25 px-1 font-sans text-[10px] leading-4 opacity-80">
              {shortcut}
            </kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
