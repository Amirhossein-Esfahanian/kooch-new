"use client";

import { useCallback } from "react";
import { useSiteCurrencyLabel } from "@/lib/currency";
import { getGuestVoucher } from "@/lib/guest-voucher";
import { VoucherDocument, VoucherField, voucherMoney } from "./VoucherDocument";
import { VoucherQueryState } from "./VoucherQueryState";
import { useVoucher } from "./useVoucher";

export function GuestVoucherView({ reservationNumber }: { reservationNumber: string }) {
  const load = useCallback((signal: AbortSignal) => getGuestVoucher(reservationNumber, signal), [reservationNumber]);
  const { state, retry } = useVoucher(load);
  const currencyLabel = useSiteCurrencyLabel(state.status === "ready" ? state.data.currencyLabel : null);
  if (state.status !== "ready") return <VoucherQueryState {...state} retry={retry} />;
  const voucher = state.data;
  return (
    <VoucherDocument voucher={voucher}>
      <VoucherField label="مبلغ پرداخت‌شده" prominent>
        {voucherMoney(voucher.grossAmount, currencyLabel)}
      </VoucherField>
    </VoucherDocument>
  );
}
