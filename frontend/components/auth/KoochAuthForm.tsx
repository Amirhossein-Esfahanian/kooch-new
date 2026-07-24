"use client";

import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useId, useMemo, useRef, useState } from "react";
import { KoochButton } from "@/components/KoochButton";

export type KoochAuthMethod = "password" | "sms" | "email";

type KoochAuthFormProps = {
  context?: "guest" | "management";
  defaultMethod?: KoochAuthMethod;
  onSubmit?: (values: {
    method: KoochAuthMethod;
    identifier: string;
    password?: string;
  }) => void | Promise<void>;
  onRegister?: () => void;
};

type MethodItem = {
  id: KoochAuthMethod;
  label: string;
  icon: ReactNode;
};

const methods: MethodItem[] = [
  {
    id: "password",
    label: "رمز عبور",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "sms",
    label: "پیامک",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path
          d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "email",
    label: "ایمیل",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path d="M4 6h16v12H4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function KoochAuthForm({
  context = "guest",
  defaultMethod = "sms",
  onSubmit,
  onRegister,
}: KoochAuthFormProps) {
  const [method, setMethod] = useState<KoochAuthMethod>(defaultMethod);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewMessage, setPreviewMessage] = useState(false);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabPanelId = `${tabsId}-panel`;

  const config = useMemo(() => {
    if (method === "password") {
      return {
        label: "شماره موبایل یا ایمیل",
        type: "text",
        inputMode: undefined,
        autoComplete: "username",
        placeholder: "شماره موبایل یا ایمیل",
        buttonText: "ورود",
        showPassword: true,
      } as const;
    }

    if (method === "email") {
      return {
        label: "ایمیل",
        type: "email",
        inputMode: "email",
        autoComplete: "email",
        placeholder: "example@email.com",
        buttonText: "ارسال کد ورود",
        showPassword: false,
      } as const;
    }

    return {
      label: "شماره موبایل",
      type: "tel",
      inputMode: "numeric",
      autoComplete: "tel",
      placeholder: "مثلاً 09123456789",
      buttonText: "ارسال کد ورود",
      showPassword: false,
    } as const;
  }, [method]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewMessage(false);

    if (!onSubmit) {
      setPreviewMessage(true);
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        method,
        identifier: identifier.trim(),
        password: config.showPassword ? password : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectMethod(nextMethod: KoochAuthMethod) {
    setMethod(nextMethod);
    setPreviewMessage(false);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = methods.length - 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const isRtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const moveForward =
        event.key === "ArrowLeft" ? isRtl : !isRtl;
      nextIndex =
        (currentIndex + (moveForward ? 1 : -1) + methods.length) %
        methods.length;
    } else {
      return;
    }

    event.preventDefault();
    selectMethod(methods[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div dir="rtl">
      <div role="tablist" aria-label="روش ورود" className="grid grid-cols-3 gap-2">
        {methods.map((item, index) => {
          const active = method === item.id;
          const tabId = `${tabsId}-${item.id}-tab`;

          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-controls={tabPanelId}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => selectMethod(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={[
                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-sm font-medium transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
              ].join(" ")}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <form
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${method}-tab`}
        onSubmit={handleSubmit}
        className="mt-5"
      >
        <div className="flex flex-col">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              {config.label}
              <span className="me-1 text-destructive">*</span>
            </span>

            <input
              type={config.type}
              inputMode={config.inputMode}
              autoComplete={config.autoComplete}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={config.placeholder}
              required
              className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>

          <div
            aria-hidden={!config.showPassword}
            className={[
              "overflow-hidden transition-[max-height,opacity,margin,transform] duration-300 ease-out",
              config.showPassword
                ? "mt-4 max-h-28 translate-y-0 opacity-100"
                : "pointer-events-none mt-0 max-h-0 -translate-y-1 opacity-0",
            ].join(" ")}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">
                رمز عبور
                <span className="me-1 text-destructive">*</span>
              </span>

              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="رمز عبور خود را وارد کنید"
                required={config.showPassword}
                disabled={!config.showPassword}
                tabIndex={config.showPassword ? 0 : -1}
                className="h-12 w-full rounded-xl border border-input bg-background px-4 text-start text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
          </div>

          <div className="mt-4">
            <KoochButton type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "در حال بررسی..." : config.buttonText}
            </KoochButton>
          </div>

          <div
            className={[
              "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
              previewMessage
                ? "mt-4 grid-rows-[1fr] opacity-100"
                : "mt-0 grid-rows-[0fr] opacity-0",
            ].join(" ")}
          >
            <div className="min-h-0 overflow-hidden">
              <div role="status" className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
                این فرم هنوز به سرویس ورود متصل نشده است.
              </div>
            </div>
          </div>
        </div>
      </form>

      {context === "guest" && (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">حساب کاربری ندارید؟</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <KoochButton
            type="button"
            variant="outline"
            className="w-full"
            onClick={onRegister}
          >
            ثبت‌نام
          </KoochButton>
        </>
      )}

      <p className="mt-5 text-center text-xs leading-6 text-muted-foreground">
        ورود شما به معنی پذیرش{" "}
        <button type="button" className="font-semibold text-primary hover:underline">
          قوانین و مقررات
        </button>{" "}
        و{" "}
        <button type="button" className="font-semibold text-primary hover:underline">
          حریم خصوصی
        </button>{" "}
        کوچ است.
      </p>
    </div>
  );
}
