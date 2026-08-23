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
      className="py-1"
      data-testid="booking-checkout-stepper"
    >
      <ol
        className="relative grid grid-cols-3 before:absolute before:inset-x-[16.667%] before:top-3 before:h-px before:bg-border before:content-['']"
        dir="rtl"
      >
        {checkoutSteps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = index < currentIndex;
          return (
            <li
              aria-current={isCurrent ? "step" : undefined}
              className="relative z-10 min-w-0 text-center"
              key={step.id}
            >
              <div
                className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-black ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCompleted
                      ? "border-primary bg-card text-primary"
                      : "border-border bg-background text-muted-foreground"
                }`}
              >
                {step.number}
              </div>
              <span
                className={`mt-1.5 block truncate px-1 text-[11px] font-bold sm:text-xs ${
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
