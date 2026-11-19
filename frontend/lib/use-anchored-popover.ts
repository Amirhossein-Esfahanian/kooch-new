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
    let placement: "above" | "below" | null = null;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 16, gap = 12;
      const width = matchTriggerWidth ? Math.max(44, Math.min(rect.width, window.innerWidth - margin * 2)) : undefined;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const height = Math.min(Math.max(popup.scrollHeight, popup.getBoundingClientRect().height), window.innerHeight - margin * 2);
      const currentSpace = placement === "above" ? above : below;
      const otherSpace = placement === "above" ? below : above;
      if (placement === null) placement = below >= height || below >= above ? "below" : "above";
      else if (currentSpace < Math.min(height, 128) && otherSpace > currentSpace + 12)
        placement = placement === "above" ? "below" : "above";
      const placeBelow = placement === "below";
      const maxHeight = Math.max(44, placeBelow ? below : above);
      const panelWidth = width ?? popup.getBoundingClientRect().width;
      const left = Math.max(margin, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin));
      const top = placeBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - Math.min(height, maxHeight));
      const next = { top, left, maxHeight, width, placement };
      setPosition(current => current && current.top === next.top && current.left === next.left &&
        current.maxHeight === next.maxHeight && current.width === next.width && current.placement === next.placement
        ? current : next);
    };
    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(popup);
    for (let ancestor: HTMLElement | null = trigger; ancestor; ancestor = ancestor.parentElement)
      observer?.observe(ancestor);
    // Transforms/recentering can move an anchor without resizing either element.
    let frame = 0;
    const trackAnchor = () => { updatePosition(); frame = window.requestAnimationFrame(trackAnchor); };
    frame = window.requestAnimationFrame(trackAnchor);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      if (popup.isConnected) popup.hidePopover?.();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [enabled, triggerRef, panelRef, matchTriggerWidth]);
  return [position, setPosition] as const;
}
