"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { KoochButton } from "@/components/KoochButton";

export type KoochInfoHintProps = {
  content: ReactNode;
  ariaLabel?: string;
  className?: string;
  popoverClassName?: string;
  openOnHoverFocus?: boolean;
  constrainToViewport?: boolean;
};

export function KoochInfoHint({
  content,
  ariaLabel = "نمایش توضیح",
  className = "",
  popoverClassName = "",
  openOnHoverFocus = false,
  constrainToViewport = false,
}: KoochInfoHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const generatedId = useId();
  const popoverId = `kooch-info-hint-${generatedId.replace(/:/g, "")}`;

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open || !constrainToViewport) return;
    const update = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const panel = popoverRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const left = Math.max(16, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 16));
      const top = anchor.bottom + 8 + panel.height <= window.innerHeight - 16
        ? anchor.bottom + 8 : Math.max(16, anchor.top - panel.height - 8);
      setPosition({ position: "fixed", left, top, right: "auto", marginTop: 0, maxHeight: "calc(100dvh - 2rem)", overflowY: "auto" });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, constrainToViewport]);

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
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    if (openOnHoverFocus) document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      if (openOnHoverFocus) document.removeEventListener("keydown", handleEscape);
    };
  }, [open, openOnHoverFocus]);

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`.trim()}
      ref={rootRef}
      onMouseEnter={openOnHoverFocus ? () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setOpen(true);
      } : undefined}
      onMouseLeave={openOnHoverFocus ? () => {
        hoverTimer.current = setTimeout(() => {
          if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
        }, 150);
      } : undefined}
      onFocus={openOnHoverFocus ? () => setOpen(true) : undefined}
      onBlur={openOnHoverFocus ? event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      } : undefined}
      onKeyDown={openOnHoverFocus ? event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      } : undefined}
    >
      <KoochButton
        aria-controls={popoverId}
        aria-expanded={open}
        aria-describedby={open && openOnHoverFocus ? popoverId : undefined}
        aria-label={ariaLabel}
        className="!h-6 !min-h-6 !w-6 !rounded-full !p-0 text-muted-foreground [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!w-11"
        onClick={() => openOnHoverFocus ? setOpen(true) : setOpen((current) => !current)}
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
          ref={popoverRef}
          style={constrainToViewport ? position : undefined}
          role="note"
        >
          {content}
        </div>
      )}
    </div>
  );
}
