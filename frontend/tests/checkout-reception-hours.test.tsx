import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CheckoutStayDetails,
  CheckoutStayDetailsReview,
  emptyCheckoutStayDetailsDraft,
  type CheckoutStayDetailsDraft,
} from "@/components/booking/CheckoutStayDetails";
import type { ReceptionHours } from "@/lib/reception-hours";

const sameDay = { regularReceptionFrom: "14:00:00", regularReceptionUntil: "23:00:00" };
const overnight = { regularReceptionFrom: "22:00:00", regularReceptionUntil: "06:00:00" };

function ArrivalForm({ hours }: { hours: ReceptionHours | null }) {
  const [draft, setDraft] = useState<CheckoutStayDetailsDraft>(emptyCheckoutStayDetailsDraft);
  return <CheckoutStayDetails draft={draft} errors={{}} onChange={setDraft} receptionHours={hours} />;
}

function chooseSameDay(time: string) {
  fireEvent.change(screen.getByLabelText("زمان تقریبی ورود", { selector: "select" }), {
    target: { value: time },
  });
}

function chooseNextDay(time: string) {
  fireEvent.change(screen.getByLabelText("زمان تقریبی ورود", { selector: "select" }), {
    target: { value: "next-day" },
  });
  fireEvent.change(screen.getByLabelText(/ساعت تقریبی ورود در بامداد روز بعد/, { selector: "input" }), {
    target: { value: time },
  });
}

describe("Guest checkout reception guidance", () => {
  it("omits guidance when reception hours are not configured", () => {
    render(<ArrivalForm hours={null} />);
    expect(screen.queryByText(/ساعت پذیرش معمول این اقامتگاه/)).toBeNull();
    expect(screen.getByLabelText("زمان تقریبی ورود", { selector: "select" })).toBeTruthy();
  });

  it("shows a calm Persian informational helper before optional arrival selection", () => {
    render(<ArrivalForm hours={sameDay} />);
    expect(screen.getByRole("status").textContent).toContain("۱۴:۰۰ تا ۲۳:۰۰");
    expect(screen.getByRole("status").textContent).toContain("زمان تقریبی ورود را مشخص کنید");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps exact same-day boundaries informational", () => {
    render(<ArrivalForm hours={sameDay} />);
    chooseSameDay("14:00:00");
    expect(screen.queryByRole("alert")).toBeNull();
    chooseSameDay("23:00:00");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns for an outside same-day arrival, then clears on an inside arrival or unset state", () => {
    render(<ArrivalForm hours={sameDay} />);
    chooseSameDay("23:59:00");
    expect(screen.getByRole("alert").textContent).toContain("پشتیبانی کوچ");
    expect(screen.queryByRole("link", { name: /پشتیبانی کوچ/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /اقامتگاه/ })).toBeNull();
    chooseSameDay("18:00:00");
    expect(screen.queryByRole("alert")).toBeNull();
    chooseSameDay("");
    expect(screen.getByRole("status").textContent).toContain("زمان تقریبی ورود را مشخص کنید");
  });

  it("warns for next-day 01:30 outside a daytime window", () => {
    render(<ArrivalForm hours={sameDay} />);
    chooseNextDay("01:30");
    expect(screen.getByRole("alert").textContent).toContain("پشتیبانی کوچ");
  });

  it("preserves the overnight meaning and does not warn for next-day 01:30", () => {
    render(<ArrivalForm hours={overnight} />);
    chooseNextDay("01:30");
    expect(screen.getByRole("status").textContent).toContain("۲۲:۰۰ تا ۰۶:۰۰ روز بعد");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds only a concise warning in review and labels a next-day arrival", () => {
    render(<CheckoutStayDetailsReview
      draft={{ ...emptyCheckoutStayDetailsDraft, expectedArrivalTime: "01:30", expectedArrivalDayOffset: 1 }}
      receptionHours={sameDay}
    />);
    expect(screen.getByText("۰۱:۳۰ روز بعد")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("پشتیبانی کوچ");
    expect(screen.queryByText(/ساعت پذیرش معمول این اقامتگاه/)).toBeNull();
  });
});
