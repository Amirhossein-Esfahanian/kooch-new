"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochUserMenu } from "@/components/KoochUserMenu";
import styles from "./PropertyDirectGuest.module.css";

const PropertyGuestAuthDialog = dynamic(() => import("./PropertyGuestAuthDialog").then((module) => module.PropertyGuestAuthDialog), {
  ssr: false, loading: () => <p role="status">در حال آماده‌سازی ورود...</p>,
});

export function PropertyGuestAccount({ slug, propertyName, navigation = [] }: { slug: string; propertyName?: string; navigation?: ReadonlyArray<{ href: string; label: string }> }) {
  const auth = useAuthSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const redirected = useRef(false);
  const href = `/book/${encodeURIComponent(slug)}/my-bookings`;
  const completeLogin = useCallback(() => {
    if (redirected.current) return;
    redirected.current = true;
    setOpen(false);
    router.push(href);
  }, [href, router]);
  useEffect(() => { setOpen(false); redirected.current = false; }, [slug]);
  useEffect(() => {
    if (open && auth.authenticated) completeLogin();
  }, [auth.authenticated, completeLogin, open]);
  useEffect(() => auth.registerInlineSessionRecovery?.(() => setOpen(false)), [auth.registerInlineSessionRecovery]);

  return <nav className={`${styles.scope} ${styles.navigation}`} dir="rtl" aria-label="راهنمای اقامتگاه">
    <div className={styles.desktopLinks}>{navigation.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</div>
    <KoochUserMenu key={`${slug}:${auth.user?.userId}:${auth.authenticated}`} variant="property" propertySlug={slug}
      propertyMenuLabel="منوی اقامتگاه" propertyLinks={navigation} triggerClassName={styles.menuTrigger} menuClassName={styles.menu}
      onPropertyLogin={() => { if (auth.loading) return; redirected.current = false; if (auth.authenticated) completeLogin(); else setOpen(true); }} />
    {open && !auth.authenticated && <PropertyGuestAuthDialog open onOpenChange={setOpen} onAuthenticated={completeLogin} propertyName={propertyName} />}
  </nav>;
}
