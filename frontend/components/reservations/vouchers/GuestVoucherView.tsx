"use client";

import { useCallback } from "react";
import { getGuestVoucher } from "@/lib/guest-voucher";
import { VoucherDocument, VoucherField, voucherMoney } from "./VoucherDocument";
import { VoucherQueryState } from "./VoucherQueryState";
import { useVoucher } from "./useVoucher";

export function GuestVoucherView({ reservationNumber }: { reservationNumber: string }) {
  const load = useCallback((signal: AbortSignal) => getGuestVoucher(reservationNumber, signal), [reservationNumber]);
  const { state, retry } = useVoucher(load);
  if (state.status !== "ready") return <VoucherQueryState {...state} retry={retry} />;
  const voucher = state.data;
  return (
    <VoucherDocument voucher={voucher}>
      <VoucherField label="مبلغ پرداخت‌شده" prominent>
        {voucherMoney(voucher.grossAmount, voucher.currency)}
      </VoucherField>
    </VoucherDocument>
  );
}
