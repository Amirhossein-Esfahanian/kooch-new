"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./UnderlineTabs.module.css";

export interface UnderlineTabItem { href: string; label: string }
export interface UnderlineTabsProps {
  items: readonly UnderlineTabItem[];
  ariaLabel: string;
  className?: string;
}

const normalizePath = (path: string) => path.replace(/\/+$/, "") || "/";

/** Route navigation: hrefs are pathnames, matched exactly (ignoring a trailing slash). */
export function UnderlineTabs({ items, ariaLabel, className = "" }: UnderlineTabsProps) {
  const pathname = usePathname();
  const current = pathname ? normalizePath(pathname) : null;
  return <nav aria-label={ariaLabel} className={`${styles.root} ${className}`}>
    {items.map(item => <Link key={item.href} href={item.href} className={styles.link}
      aria-current={current === normalizePath(item.href) ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}
