export type BookingCheckoutStep = "stay" | "information" | "review";

const checkoutSteps: Array<{
  id: BookingCheckoutStep;
  label: string;
  number: string;
}> = [
  { id: "stay", label: "انتخاب اقامت", number: "۱" },
  { id: "information", label: "اطلاعات", number: "۲" },
  { id: "review", label: "نهایی‌سازی", number: "۳" },
];

export function BookingCheckoutStepper({
  currentStep,
}: {
  currentStep: BookingCheckoutStep;
}) {
  const currentIndex = checkoutSteps.findIndex((step) => step.id === currentStep);

  return (
    <nav
      aria-label="مراحل تکمیل رزرو"
      className="flex h-[var(--checkout-timeline-height)] items-center"
      data-testid="booking-checkout-stepper"
    >
      <ol className="flex w-full min-w-0 items-center" dir="rtl">
        {checkoutSteps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = index < currentIndex;
          return (
            <li
              aria-current={isCurrent ? "step" : undefined}
              className={`flex min-w-0 items-center ${
                index < checkoutSteps.length - 1 ? "flex-1" : "shrink-0"
              }`}
              key={step.id}
            >
              <div
                className="flex shrink-0 items-center gap-1 sm:gap-2"
                data-testid={`checkout-step-group-${step.id}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCompleted
                      ? "border-primary bg-card text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {step.number}
                </span>
                <span
                  className={`whitespace-nowrap text-[10px] font-bold sm:text-xs ${
                    isCurrent || isCompleted ? "text-white" : "text-white/70"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < checkoutSteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`mx-1 h-px min-w-2 flex-1 sm:mx-3 ${
                    isCompleted ? "bg-primary" : "bg-white/30"
                  }`}
                  data-testid="checkout-step-connector"
                />
              ) : null}
              <span className="sr-only">
                {isCurrent ? "مرحله فعلی" : isCompleted ? "تکمیل‌شده" : "انجام‌نشده"}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
