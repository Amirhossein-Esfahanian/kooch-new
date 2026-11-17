import { toPersianDigits } from "@/lib/persian-digits";
import styles from "./NumberedSteps.module.css";

export function NumberedSteps({ labels, currentStep, complete = false, label }: {
  labels: readonly string[]; currentStep: number; complete?: boolean; label: string;
}) {
  return <ol className={styles.steps} aria-label={label} dir="rtl">
    {labels.map((text, index) => {
      const completed = complete || index + 1 < currentStep;
      const active = !complete && index + 1 === currentStep;
      return <li key={text} aria-current={active ? "step" : undefined}
        data-state={completed ? "completed" : active ? "active" : "upcoming"}>
        <span className={styles.number} aria-hidden="true">{completed
          ? <svg viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : toPersianDigits(index + 1)}</span>
        {text}{completed && <span className="sr-only"> (تکمیل‌شده)</span>}
      </li>;
    })}
  </ol>;
}
