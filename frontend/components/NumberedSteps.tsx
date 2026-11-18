import { toPersianDigits } from "@/lib/persian-digits";
import styles from "./NumberedSteps.module.css";

export function NumberedSteps({ labels, currentStep, complete = false, label, className = "" }: {
  labels: readonly string[]; currentStep: number; complete?: boolean; label: string; className?: string;
}) {
  return <ol className={`${styles.steps} ${className}`} aria-label={label} dir="rtl">
    {labels.map((text, index) => {
      const completed = complete || index + 1 < currentStep;
      const active = !complete && index + 1 === currentStep;
      return <li key={text} aria-current={active ? "step" : undefined}
        data-state={completed ? "completed" : active ? "active" : "upcoming"}>
        <span className={styles.number} aria-hidden="true">{toPersianDigits(index + 1)}</span>
        <span className={styles.label}>{text}{completed && <span className="sr-only"> (تکمیل‌شده)</span>}</span>
        {index < labels.length - 1 && <span className={styles.connector} aria-hidden="true"
          data-step-connector={completed ? "completed" : "upcoming"}>
          <span className={styles.progress} />
        </span>}
      </li>;
    })}
  </ol>;
}
