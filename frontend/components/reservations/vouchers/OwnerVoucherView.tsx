"use client";

import { useCallback } from "react";
import { getOwnerVoucher } from "@/lib/owner-voucher";
import { formatNumber } from "@/lib/account-reservations";
import { VoucherDocument, VoucherField, voucherMoney } from "./VoucherDocument";
import { VoucherQueryState } from "./VoucherQueryState";
import { useVoucher } from "./useVoucher";

export function OwnerVoucherView({ propertyId, reservationId }: { propertyId: number; reservationId: number }) {
  const load = useCallback((signal: AbortSignal) => getOwnerVoucher(propertyId, reservationId, signal), [propertyId, reservationId]);
  const { state, retry } = useVoucher(load);
  if (state.status !== "ready") return <VoucherQueryState {...state} retry={retry} />;
  const voucher = state.data;
  return (
    <VoucherDocument voucher={voucher}>
      <VoucherField label="مبلغ پرداخت‌شده مهمان">{voucherMoney(voucher.grossAmount, voucher.currency)}</VoucherField>
      <VoucherField label="نرخ کمیسیون Kooch">{formatNumber(voucher.commissionRate)}٪</VoucherField>
      <VoucherField label="کمیسیون Kooch">{voucherMoney(voucher.commissionAmount, voucher.currency)}</VoucherField>
      <VoucherField label="مبلغ قابل تسویه به اقامتگاه" prominent>{voucherMoney(voucher.propertyPayableAmount, voucher.currency)}</VoucherField>
    </VoucherDocument>
  );
}
