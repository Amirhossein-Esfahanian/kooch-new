"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochUserMenu } from "@/components/KoochUserMenu";
import { CheckoutIdentityStep } from "@/components/booking/CheckoutIdentityStep";

export function PropertyGuestAccount({ slug }: { slug: string }) {
  const auth = useAuthSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const redirected = useRef(false);
  const href = `/book/${encodeURIComponent(slug)}/my-bookings`;
  const completeLogin = useCallback(() => {
    if (redirected.current) return;
    redirected.current = true;
    setOpen(false);
    router.push(href);
  }, [href, router]);
  useEffect(() => { setOpen(false); setBusy(false); redirected.current = false; }, [slug]);
  useEffect(() => {
    if (open && auth.authenticated) completeLogin();
  }, [auth.authenticated, completeLogin, open]);
  useEffect(() => auth.registerInlineSessionRecovery?.(() => setOpen(false)), [auth.registerInlineSessionRecovery]);

  return <div className="relative z-50" dir="rtl">
    {auth.authenticated ? <KoochUserMenu key={`${slug}:${auth.user?.userId}`} variant="property" propertySlug={slug} />
      : <KoochButton className="min-h-11" disabled={auth.loading} variant="outline" onClick={() => { redirected.current = false; if (auth.authenticated) completeLogin(); else setOpen(true); }}>ورود / ثبت‌نام</KoochButton>}
    <KoochDialog open={open && !auth.authenticated} onOpenChange={(next) => { if (!busy) setOpen(next); }} closeDisabled={busy} title="ورود / ثبت‌نام" description="با شماره موبایل حساب مشترک خود وارد شوید." size="md">
      {open && !auth.authenticated && <CheckoutIdentityStep intent="account" allowAlternateLogin={false} onBusyChange={setBusy} onAuthenticated={completeLogin} />}
    </KoochDialog>
  </div>;
}
