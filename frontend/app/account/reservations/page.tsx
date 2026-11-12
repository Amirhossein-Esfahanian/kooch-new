"use client";

import { Suspense, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveSessionDestination, useAuthSession } from "@/components/auth/AuthSessionProvider";
import { GuestReservationsList } from "@/components/account/GuestReservationsList";
import { GuestOrdersList } from "@/components/account/GuestOrdersList";
import { GuestBookingListSkeleton } from "@/components/account/GuestBookingListSkeleton";
import styles from "./page.module.css";

const tabs = [
  { value: "reservations", label: "رزروها" },
  { value: "orders", label: "سفارش‌ها" },
] as const;

function ReservationPanels() {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("tab") === "orders" ? "orders" : "reservations";
  const [reservationPage, setReservationPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [focused, setFocused] = useState(active);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  useEffect(() => { setFocused(active); }, [active]);

  function activate(value: typeof active) {
    if (value === active) return;
    const next = new URLSearchParams(params.toString());
    next.set("tab", value);
    router.push(`/account/reservations?${next.toString()}`, { scroll: false });
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); activate(tabs[index].value); return;
    }
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const forward = event.key === "ArrowLeft" ? rtl : !rtl;
      next = (index + (forward ? 1 : -1) + tabs.length) % tabs.length;
    } else return;
    event.preventDefault();
    setFocused(tabs[next].value); buttons.current[next]?.focus();
  }

  return <>
    <div className={styles.tabs} role="tablist" aria-label="رزروهای من" aria-orientation="horizontal" dir="rtl">
      {tabs.map((tab, index) => <button key={tab.value} type="button" role="tab" id={`${id}-${tab.value}-tab`}
        aria-controls={`${id}-${tab.value}-panel`} aria-selected={active === tab.value}
        tabIndex={focused === tab.value ? 0 : -1} className={styles.tab}
        ref={node => { buttons.current[index] = node; }} onFocus={() => setFocused(tab.value)}
        onClick={() => activate(tab.value)} onKeyDown={event => navigate(event, index)}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <section key={tab.value} id={`${id}-${tab.value}-panel`} role="tabpanel"
      aria-labelledby={`${id}-${tab.value}-tab`} tabIndex={0} hidden={active !== tab.value} className={styles.panel}>
      {active === tab.value && (tab.value === "reservations"
        ? <GuestReservationsList page={reservationPage} onPageChange={setReservationPage} />
        : <GuestOrdersList page={orderPage} onPageChange={setOrderPage} />)}
    </section>)}
  </>;
}

export default function AccountReservationsPage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading: sessionLoading, workspaces } = session;
  useEffect(() => {
    if (sessionLoading) return;
    if (!authenticated) {
      router.replace("/login");
      return;
    }
    if (!workspaces.includes("account")) router.replace(resolveSessionDestination(session));
  }, [authenticated, router, session, sessionLoading, workspaces]);

  return (
    <main className={styles.page} dir="rtl">
        <header className={styles.header}>
          <h1>رزروهای من</h1>
          <p>جزئیات اقامت، وضعیت رزرو و پیگیری سفارش‌های شما.</p>
        </header>
        <Suspense fallback={<GuestBookingListSkeleton kind="reservations" />}>
          <ReservationPanels />
        </Suspense>
    </main>
  );
}
