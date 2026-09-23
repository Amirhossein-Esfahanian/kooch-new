"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { KoochButton } from "@/components/KoochButton";

export type KoochInfoHintProps = {
  content: ReactNode;
  ariaLabel?: string;
  className?: string;
  popoverClassName?: string;
};

export function KoochInfoHint({
  content,
  ariaLabel = "نمایش توضیح",
  className = "",
  popoverClassName = "",
}: KoochInfoHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const popoverId = `kooch-info-hint-${generatedId.replace(/:/g, "")}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`.trim()}
      ref={rootRef}
    >
      <KoochButton
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="!h-6 !min-h-6 !w-6 !rounded-full !p-0 text-muted-foreground [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!w-11"
        onClick={() => setOpen((current) => !current)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 bg-current"
          style={{
            WebkitMask:
              "url(/svgs/info-circle.svg) center / contain no-repeat",
            mask: "url(/svgs/info-circle.svg) center / contain no-repeat",
          }}
        />
      </KoochButton>

      {open && (
        <div
          className={`absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-right text-xs font-normal leading-6 text-popover-foreground shadow-lg ${popoverClassName}`.trim()}
          id={popoverId}
          role="note"
        >
          {content}
        </div>
      )}
    </div>
  );
}
