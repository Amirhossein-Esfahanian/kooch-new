"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AdminReservationsWorkspace } from "@/components/reservations/AdminReservationsWorkspace";

function DetailsRoute() {
  const { reservationId } = useParams<{ reservationId: string }>();
  return <AdminReservationsWorkspace key={reservationId} reservationId={Number(reservationId)} />;
}

export default function AdminReservationDetailsPage() {
  return <Suspense fallback={null}><DetailsRoute /></Suspense>;
}
