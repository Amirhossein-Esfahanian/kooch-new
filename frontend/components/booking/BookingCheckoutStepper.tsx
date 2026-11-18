import { NumberedSteps } from "@/components/NumberedSteps";

export type BookingCheckoutStep = "stay" | "information" | "review";

const checkoutSteps: Array<{
  id: BookingCheckoutStep;
  label: string;
}> = [
  { id: "stay", label: "انتخاب اقامت" },
  { id: "information", label: "اطلاعات" },
  { id: "review", label: "نهایی‌سازی" },
];

export function BookingCheckoutStepper({
  currentStep,
}: {
  currentStep: BookingCheckoutStep;
}) {
  const currentIndex = checkoutSteps.findIndex(
    (step) => step.id === currentStep,
  );

  return (
    <nav
      aria-label="مراحل تکمیل رزرو"
      className="flex min-h-[var(--checkout-timeline-height)] items-center"
      data-testid="booking-checkout-stepper"
    >
      <NumberedSteps label="مراحل تکمیل رزرو" labels={checkoutSteps.map(step => step.label)} currentStep={currentIndex + 1}
        className="[--step-label:var(--primary-foreground)] dark:[--step-label:var(--foreground)] [--step-muted:var(--step-label)] [--step-line:color-mix(in_srgb,var(--step-label)_35%,transparent)]" />
    </nav>
  );
}
