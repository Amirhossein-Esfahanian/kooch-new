"use client";

import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";

export function ManualReceiptFields({ method, reference, onMethodChange, onReferenceChange, disabled = false }: {
  method: string; reference: string; onMethodChange: (value: string) => void;
  onReferenceChange: (value: string) => void; disabled?: boolean;
}) {
  return <>
    <KoochField label="روش دریافت وجه"><KoochSelect disabled={disabled} value={method}
      onChange={event => onMethodChange(event.target.value)}>
      <option value="BankTransfer">واریز بانکی</option><option value="CardToCard">کارت به کارت</option>
      <option value="Paya">پایا</option><option value="Satna">ساتنا</option>
      <option value="AccountTransfer">انتقال حساب</option><option value="Other">سایر</option>
    </KoochSelect></KoochField>
    <KoochField label="شماره پیگیری (اختیاری)"><KoochInput maxLength={200} disabled={disabled}
      value={reference} onChange={event => onReferenceChange(event.target.value)} /></KoochField>
  </>;
}
