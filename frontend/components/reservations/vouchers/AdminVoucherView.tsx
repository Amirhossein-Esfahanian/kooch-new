"use client";

import { useCallback } from "react";
import { getAdminVoucher } from "@/lib/admin-voucher";
import { FinancialVoucherView } from "./OwnerVoucherView";

export function AdminVoucherView({ reservationId }: { reservationId: number }) {
  const load = useCallback((signal: AbortSignal) => getAdminVoucher(reservationId, signal), [reservationId]);
  return <FinancialVoucherView load={load} />;
}
