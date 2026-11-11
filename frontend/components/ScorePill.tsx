"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { getRatingQuality } from "@/lib/rating-quality";
import styles from "./ScorePill.module.css";

export interface ScorePillProps {
  name: string;
  label: string;
  value?: number | null;
  onChange: (score: number) => void;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  dir?: "rtl" | "ltr";
}

export function ScorePill({ name, label, value, onChange, required = false, disabled = false,
  invalid = false, describedBy, dir = "rtl" }: ScorePillProps) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  const selected = value != null && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
  const quality = selected === null ? null : getRatingQuality(selected);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const radios = Array.from(group.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);
    const focused = radios.indexOf(event.target as HTMLInputElement);
    if (focused < 0 || radios[focused].matches(":disabled")) return;
    event.preventDefault();
    const forward = event.key === "ArrowDown" || event.key === (dir === "rtl" ? "ArrowLeft" : "ArrowRight");
    const next = event.key === "Home" ? 0 : event.key === "End" ? 9 : (focused + (forward ? 1 : -1) + 10) % 10;
    onChange(next + 1);
    radios[next].focus();
  }

  return <div className={styles.root} dir={dir} data-quality={quality?.tone}>
    <div className={styles.headingRow}>
      <div id={`${id}-label`} className={styles.label}>{label}{required && <span aria-hidden="true"> *</span>}</div>
      <p id={`${id}-feedback`} className={styles.feedback} aria-live="polite" aria-atomic="true">{quality?.label ?? ""}</p>
    </div>
    <div className={styles.control} ref={group} role="radiogroup" aria-labelledby={`${id}-label`}
      aria-required={required} aria-invalid={invalid || undefined} aria-disabled={disabled || undefined}
      aria-describedby={[`${id}-feedback`, describedBy].filter(Boolean).join(" ")} onKeyDown={navigate}>
      <div className={styles.track}>
        {selected !== null && <span className={styles.selectionViewport} aria-hidden="true"><span className={styles.selection}
          style={{ transform: `translateX(${(dir === "rtl" ? -1 : 1) * (selected - 1) * 100}%)` }} /></span>}
        {Array.from({ length: 10 }, (_, index) => index + 1).map(score => <label className={styles.option} key={score}>
          <input type="radio" name={name} value={score} checked={selected === score} required={required} disabled={disabled}
            tabIndex={selected === score || selected === null && score === 1 ? 0 : -1}
            aria-label={`${score.toLocaleString("fa-IR")} از ۱۰`} onChange={() => onChange(score)} />
          <span className={styles.number} aria-hidden="true">{score.toLocaleString("fa-IR")}</span>
        </label>)}
      </div>
    </div>
  </div>;
}
