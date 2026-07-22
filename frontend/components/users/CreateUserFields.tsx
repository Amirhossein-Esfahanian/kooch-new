"use client";

import {
  KoochField,
  KoochInput,
} from "@/components/KoochFormControls";

export type CreateUserIdentity = {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
};

export type CreateUserIdentityErrors = Partial<
  Record<keyof CreateUserIdentity, string>
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateUserIdentity(
  value: CreateUserIdentity,
): CreateUserIdentityErrors {
  const errors: CreateUserIdentityErrors = {};

  if (!value.firstName.trim()) {
    errors.firstName = "نام را وارد کنید.";
  }

  if (!value.lastName.trim()) {
    errors.lastName = "نام خانوادگی را وارد کنید.";
  }

  if (!value.mobile.trim()) {
    errors.mobile = "شماره موبایل را وارد کنید.";
  }

  const email = value.email.trim();
  if (email && !emailPattern.test(email)) {
    errors.email = "ایمیل واردشده معتبر نیست.";
  }

  return errors;
}

export function hasCreateUserIdentityErrors(
  errors: CreateUserIdentityErrors,
) {
  return Object.keys(errors).length > 0;
}

export function getCreateUserApiError(
  caught: unknown,
  fallback = "ساخت کاربر انجام نشد.",
) {
  const message = caught instanceof Error ? caught.message.trim() : "";
  const normalized = message.toLocaleLowerCase("en-US");

  if (
    normalized.includes("phone") &&
    (normalized.includes("already") ||
      normalized.includes("duplicate") ||
      normalized.includes("unique"))
  ) {
    return "این شماره موبایل قبلاً ثبت شده است.";
  }

  if (
    normalized.includes("email") &&
    (normalized.includes("already") ||
      normalized.includes("duplicate") ||
      normalized.includes("unique"))
  ) {
    return "این ایمیل قبلاً ثبت شده است.";
  }

  return message || fallback;
}

export function CreateUserFields({
  className = "",
  disabled = false,
  errors = {},
  idPrefix,
  mobileReadOnly = false,
  onChange,
  value,
}: {
  className?: string;
  disabled?: boolean;
  errors?: CreateUserIdentityErrors;
  idPrefix: string;
  mobileReadOnly?: boolean;
  onChange: (value: CreateUserIdentity) => void;
  value: CreateUserIdentity;
}) {
  function update(field: keyof CreateUserIdentity, nextValue: string) {
    onChange({ ...value, [field]: nextValue });
  }

  return (
    <div
      className={`grid gap-4 md:grid-cols-2 ${className}`.trim()}
      data-testid="create-user-fields"
      dir="rtl"
    >
      <KoochField error={errors.firstName} label="نام" required>
        <KoochInput
          autoComplete="given-name"
          disabled={disabled}
          error={errors.firstName}
          id={`${idPrefix}-first-name`}
          onChange={(event) => update("firstName", event.target.value)}
          required
          value={value.firstName}
        />
      </KoochField>

      <KoochField error={errors.lastName} label="نام خانوادگی" required>
        <KoochInput
          autoComplete="family-name"
          disabled={disabled}
          error={errors.lastName}
          id={`${idPrefix}-last-name`}
          onChange={(event) => update("lastName", event.target.value)}
          required
          value={value.lastName}
        />
      </KoochField>

      <KoochField error={errors.mobile} label="شماره موبایل" required>
        <KoochInput
          autoComplete="tel"
          disabled={disabled}
          dir="ltr"
          error={errors.mobile}
          id={`${idPrefix}-mobile`}
          inputMode="tel"
          onChange={(event) => update("mobile", event.target.value)}
          readOnly={mobileReadOnly}
          required
          value={value.mobile}
        />
      </KoochField>

      <KoochField
        error={errors.email}
        helperText="اختیاری"
        label="ایمیل"
      >
        <KoochInput
          autoComplete="email"
          disabled={disabled}
          dir="ltr"
          error={errors.email}
          id={`${idPrefix}-email`}
          onChange={(event) => update("email", event.target.value)}
          type="email"
          value={value.email}
        />
      </KoochField>
    </div>
  );
}
