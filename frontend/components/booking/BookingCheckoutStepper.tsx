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
    <nav aria-label="مراحل تکمیل رزرو" data-testid="booking-checkout-stepper">
      <ol className="grid grid-cols-3 gap-2" dir="rtl">
        {checkoutSteps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = index < currentIndex;
          return (
            <li
              aria-current={isCurrent ? "step" : undefined}
              className="min-w-0 text-center"
              key={step.id}
            >
              <div
                className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full border text-sm font-black ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCompleted
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground"
                }`}
              >
                {step.number}
              </div>
              <span
                className={`mt-2 block truncate text-xs font-bold sm:text-sm ${
                  isCurrent || isCompleted ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
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
