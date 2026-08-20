"use client";

import { useState } from "react";
import { KoochCompactDateRangePicker } from "@/components/KoochCompactDateRangePicker";
import type { SharedDateRangeValue } from "@/components/SharedDateRangePicker";

const emptyRange: SharedDateRangeValue = { startDate: null, endDate: null };
const existingRange: SharedDateRangeValue = {
  startDate: "2030-08-20",
  endDate: "2030-08-22",
};

type ExampleProps = {
  description: string;
  initialValue: SharedDateRangeValue;
  title: string;
  fieldSize: "standard" | "compact";
  daySpacing?: "compact" | "normal" | "comfortable";
};

function PickerExample({
  description,
  initialValue,
  title,
  fieldSize,
  daySpacing,
}: ExampleProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <section className="grid gap-4 border-t border-border py-7 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <KoochCompactDateRangePicker
          daySpacing={daySpacing}
          fieldSize={fieldSize}
          onChange={setValue}
          value={value}
        />
      </div>

      <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-semibold text-foreground">Start ISO:</dt>
          <dd className="break-all" dir="ltr">{value.startDate ?? "—"}</dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 font-semibold text-foreground">End ISO:</dt>
          <dd className="break-all" dir="ltr">{value.endDate ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function DatePickerTestSurface() {
  return (
    <main
      className="fixed bottom-0 left-0 top-16 z-40 w-screen overflow-y-auto bg-background px-4 py-10 text-foreground sm:px-8"
      dir="ltr"
    >
      <div className="mx-auto w-full max-w-5xl" dir="rtl">
        <header className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-black sm:text-3xl">تست تقویم بازه‌ای</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            برای بررسی commit خودکار، یک بازه کامل انتخاب کنید. انتخاب ناقص با
            خروج از تقویم یا فشردن Escape کنار گذاشته می‌شود.
          </p>
        </header>

        <div className="rounded-lg border border-border bg-card px-4 py-6 sm:px-6">
          <PickerExample
            description="فیلد استاندارد بدون مقدار اولیه"
            fieldSize="standard"
            initialValue={emptyRange}
            title="Standard — Empty"
          />
          <PickerExample
            description="فیلد استاندارد با تاریخ ورود و خروج ثبت‌شده"
            fieldSize="standard"
            initialValue={existingRange}
            title="Standard — Existing Value"
          />
          <PickerExample
            description="فیلد کم‌ارتفاع برای نوارهای جست‌وجوی افقی"
            fieldSize="compact"
            initialValue={emptyRange}
            title="Compact — Empty"
          />
          <PickerExample
            description="مقایسه سلسله‌مراتب تاریخ و روز هفته در حالت فشرده"
            fieldSize="compact"
            initialValue={existingRange}
            title="Compact — Existing Value"
          />
          <PickerExample
            daySpacing="compact"
            description="نمونه تقویم با فاصله‌گذاری فشرده و سطح لمس حفظ‌شده"
            fieldSize="compact"
            initialValue={existingRange}
            title="Compact Calendar Spacing"
          />
        </div>
      </div>
    </main>
  );
}
