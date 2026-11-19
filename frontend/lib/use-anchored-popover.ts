"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export function useAnchoredPopover(enabled: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>, panelRef: RefObject<HTMLDivElement | null>,
  matchTriggerWidth = false) {
  const [position, setPosition] = useState<{
    top: number; left: number; maxHeight: number; width?: number; placement: "above" | "below";
  } | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const popup = panelRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    popup.showPopover?.();
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 16, gap = 12;
      const width = matchTriggerWidth ? Math.max(44, Math.min(rect.width, window.innerWidth - margin * 2)) : undefined;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const height = Math.min(popup.scrollHeight, window.innerHeight - margin * 2);
      const placeBelow = below >= height || below >= above;
      const maxHeight = Math.max(44, placeBelow ? below : above);
      const panelWidth = width ?? popup.getBoundingClientRect().width;
      const left = Math.max(margin, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin));
      const top = placeBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - Math.min(height, maxHeight));
      setPosition({ top, left, maxHeight, width, placement: placeBelow ? "below" : "above" });
    };
    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(popup);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      if (popup.isConnected) popup.hidePopover?.();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [enabled, triggerRef, panelRef, matchTriggerWidth]);
  return [position, setPosition] as const;
}
