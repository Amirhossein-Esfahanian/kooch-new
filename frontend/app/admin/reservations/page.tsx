"use client";
import { Suspense } from "react";
import { AdminReservationsWorkspace } from "@/components/reservations/AdminReservationsWorkspace";

export default function AdminReservationsPage() {
  return <Suspense fallback={null}><AdminReservationsWorkspace /></Suspense>;
}
