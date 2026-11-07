"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./MarketplacePropertyDetail.module.css";

export const propertySections = [
  { id: "property-overview", label: "معرفی اقامتگاه" },
  { id: "property-highlights", label: "ویژگی‌های برجسته" },
  { id: "property-facilities", label: "امکانات" },
  { id: "property-rooms", label: "اتاق‌ها" },
  { id: "property-reviews", label: "نظرات مهمانان" },
  { id: "property-location", label: "موقعیت مکانی" },
  { id: "property-policies", label: "قوانین و مقررات" },
] as const;

type SectionId = typeof propertySections[number]["id"];
const scrollBehavior = (): ScrollBehavior => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function useMarketplacePropertyNavigation() {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState<SectionId>("property-overview");
  const target = useRef<{ id: SectionId; until: number } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // PublicSiteShell's header is a sibling of main, never an in-page or Direct header.
    const sibling = root.closest("main")?.previousElementSibling;
    const header = sibling instanceof HTMLElement && sibling.tagName === "HEADER" ? sibling : null;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const nextCollapsed = window.scrollY > 120 && !header?.contains(document.activeElement);
      header?.classList.toggle(styles.siteHeaderHidden, nextCollapsed);
      setCollapsed(nextCollapsed);
      const headerHeight = nextCollapsed ? 0 : header?.getBoundingClientRect().height ?? 0;
      const searchHeight = searchRef.current?.getBoundingClientRect().height ?? 0;
      const navigationHeight = navigationRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--marketplace-search-height", `${searchHeight}px`);
      root.style.setProperty("--marketplace-navigation-height", `${navigationHeight}px`);
      const offset = headerHeight + searchHeight + navigationHeight;
      setStuck((sentinelRef.current?.getBoundingClientRect().top ?? Infinity) <= headerHeight + searchHeight);
      if (target.current) {
        const destination = root.querySelector<HTMLElement>(`#${target.current.id}`);
        if (destination && performance.now() < target.current.until && Math.abs(destination.getBoundingClientRect().top - offset - 16) > 4) return;
        target.current = null;
      }
      let next: SectionId = "property-overview";
      if (window.scrollY > 0) {
        for (const section of propertySections) {
          const element = root.querySelector<HTMLElement>(`#${section.id}`);
          if (element && element.getBoundingClientRect().top <= offset + 24) next = section.id;
        }
        const height = document.documentElement.scrollHeight;
        if (height > window.innerHeight && window.scrollY + window.innerHeight >= height - 2) next = "property-policies";
      }
      setActive(next);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
    const interrupt = () => { target.current = null; schedule(); };
    const interruptWithKeyboard = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) interrupt();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (searchRef.current) observer?.observe(searchRef.current);
    if (navigationRef.current) observer?.observe(navigationRef.current);
    if (header) observer?.observe(header);
    header?.addEventListener("focusout", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("pointerdown", interrupt, { passive: true });
    window.addEventListener("keydown", interruptWithKeyboard);
    update();
    const initialSection = propertySections.find((section) => `#${section.id}` === window.location.hash);
    if (initialSection) {
      target.current = { id: initialSection.id, until: performance.now() + 1800 };
      setActive(initialSection.id);
      root.querySelector<HTMLElement>(`#${initialSection.id}`)?.scrollIntoView?.({ behavior: "auto", block: "start" });
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      header?.classList.remove(styles.siteHeaderHidden);
      header?.removeEventListener("focusout", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("pointerdown", interrupt);
      window.removeEventListener("keydown", interruptWithKeyboard);
    };
  }, []);

  function navigate(id: SectionId) {
    const element = rootRef.current?.querySelector<HTMLElement>(`#${id}`);
    if (!element) return;
    target.current = { id, until: performance.now() + 1800 };
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
  }

  function backToTop() {
    target.current = null;
    rootRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }

  return { rootRef, searchRef, navigationRef, sentinelRef, active, collapsed, stuck, navigate, backToTop };
}
