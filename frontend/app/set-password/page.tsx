"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochField, KoochInput } from "@/components/KoochFormControls";

type PasswordSetupTokenStatus = "Valid" | "Invalid" | "Expired" | "Used";
type SetupState = "checking" | "valid" | "invalid" | "expired" | "used" | "success";

const fa = (codes: string) =>
  codes
    .split(" ")
    .map((code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .join("");

const COPY = {
  loading: fa("062F 0631 20 062D 0627 0644 20 0628 0627 0631 06AF 0630 0627 0631 06CC 002E 002E 002E"),
  passwordInvalid: fa("0631 0645 0632 20 0639 0628 0648 0631 20 0628 0627 06CC 062F 20 062D 062F 0627 0642 0644 20 06F8 20 06A9 0627 0631 0627 06A9 062A 0631 20 0648 20 0634 0627 0645 0644 20 062D 0631 0641 20 0627 0646 06AF 0644 06CC 0633 06CC 20 06A9 0648 0686 06A9 20 0648 20 0639 062F 062F 20 0628 0627 0634 062F 002E"),
  checkingTitle: fa("0628 0631 0631 0633 06CC 20 0644 06CC 0646 06A9"),
  checkingDescription: fa("062F 0631 20 062D 0627 0644 20 0628 0631 0631 0633 06CC 20 0627 0639 062A 0628 0627 0631 20 0644 06CC 0646 06A9 20 062F 0639 0648 062A 20 0647 0633 062A 06CC 0645 002E"),
  invalidTitle: fa("0644 06CC 0646 06A9 20 0646 0627 0645 0639 062A 0628 0631 20 0627 0633 062A"),
  invalidDescription: fa("0627 06CC 0646 20 0644 06CC 0646 06A9 20 062A 0646 0638 06CC 0645 20 0631 0645 0632 20 0639 0628 0648 0631 20 0645 0639 062A 0628 0631 20 0646 06CC 0633 062A 002E"),
  expiredTitle: fa("0644 06CC 0646 06A9 20 0645 0646 0642 0636 06CC 20 0634 062F 0647 20 0627 0633 062A"),
  expiredDescription: fa("0645 0647 0644 062A 20 0627 0633 062A 0641 0627 062F 0647 20 0627 0632 20 0627 06CC 0646 20 0644 06CC 0646 06A9 20 067E 0627 06CC 0627 0646 20 06CC 0627 0641 062A 0647 20 0627 0633 062A 002E"),
  usedTitle: fa("0627 06CC 0646 20 0644 06CC 0646 06A9 20 0642 0628 0644 0627 064B 20 0627 0633 062A 0641 0627 062F 0647 20 0634 062F 0647 20 0627 0633 062A"),
  usedDescription: fa("0644 06CC 0646 06A9 200C 0647 0627 06CC 20 062A 0646 0638 06CC 0645 20 0631 0645 0632 20 0639 0628 0648 0631 20 0641 0642 0637 20 06CC 06A9 20 0628 0627 0631 20 0642 0627 0628 0644 20 0627 0633 062A 0641 0627 062F 0647 20 0647 0633 062A 0646 062F 002E"),
  successTitle: fa("0631 0645 0632 20 0639 0628 0648 0631 20 062A 0646 0638 06CC 0645 20 0634 062F"),
  successDescription: fa("062A 0627 20 0686 0646 062F 20 0644 062D 0638 0647 20 062F 06CC 06AF 0631 20 0628 0647 20 0635 0641 062D 0647 20 0648 0631 0648 062F 20 0645 0646 062A 0642 0644 20 0645 06CC 200C 0634 0648 06CC 062F 002E"),
  invitation: fa("062F 0639 0648 062A 20 06A9 0627 0631 0628 0631 06CC"),
  setPassword: fa("062A 0646 0638 06CC 0645 20 0631 0645 0632 20 0639 0628 0648 0631"),
  intro: fa("0628 0631 0627 06CC 20 0641 0639 0627 0644 20 0634 062F 0646 20 062D 0633 0627 0628 060C 20 0631 0645 0632 20 0639 0628 0648 0631 20 062E 0648 062F 20 0631 0627 20 0648 0627 0631 062F 20 06A9 0646 06CC 062F 002E"),
  unableCheck: fa("0627 0645 06A9 0627 0646 20 0628 0631 0631 0633 06CC 20 0644 06CC 0646 06A9 20 0648 062C 0648 062F 20 0646 062F 0627 0631 062F 002E"),
  invalidLink: fa("0644 06CC 0646 06A9 20 062A 0646 0638 06CC 0645 20 0631 0645 0632 20 0639 0628 0648 0631 20 0645 0639 062A 0628 0631 20 0646 06CC 0633 062A 002E"),
  mismatch: fa("062A 06A9 0631 0627 0631 20 0631 0645 0632 20 0639 0628 0648 0631 20 0628 0627 20 0631 0645 0632 20 0639 0628 0648 0631 20 06CC 06A9 0633 0627 0646 20 0646 06CC 0633 062A 002E"),
  failed: fa("062A 0646 0638 06CC 0645 20 0631 0645 0632 20 0639 0628 0648 0631 20 0627 0646 062C 0627 0645 20 0646 0634 062F 002E"),
  successToast: fa("0631 0645 0632 20 0639 0628 0648 0631 20 0628 0627 20 0645 0648 0641 0642 06CC 062A 20 062A 0646 0638 06CC 0645 20 0634 062F 002E"),
  passwordHelper: fa("062D 062F 0627 0642 0644 20 06F8 20 06A9 0627 0631 0627 06A9 062A 0631 060C 20 0634 0627 0645 0644 20 062D 0631 0641 20 0627 0646 06AF 0644 06CC 0633 06CC 20 06A9 0648 0686 06A9 20 0648 20 0639 062F 062F 002E"),
  newPassword: fa("0631 0645 0632 20 0639 0628 0648 0631 20 062C 062F 06CC 062F"),
  confirmPassword: fa("062A 06A9 0631 0627 0631 20 0631 0645 0632 20 0639 0628 0648 0631"),
  submit: fa("062B 0628 062A 20 0631 0645 0632 20 0639 0628 0648 0631"),
  login: fa("0631 0641 062A 0646 20 0628 0647 20 0648 0631 0648 062F"),
};

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<SetPasswordFallback />}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordFallback() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <p className="text-sm font-semibold text-muted-foreground">{COPY.loading}</p>
      </KoochCard>
    </main>
  );
}

function validatePassword(password: string) {
  if (password.length < 8 || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return COPY.passwordInvalid;
  }

  return "";
}

function mapTokenStatus(status: PasswordSetupTokenStatus): SetupState {
  switch (status) {
    case "Valid":
      return "valid";
    case "Expired":
      return "expired";
    case "Used":
      return "used";
    default:
      return "invalid";
  }
}

function mapErrorToState(message: string): SetupState | null {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired")) return "expired";
  if (normalized.includes("used") || normalized.includes("revoked")) return "used";
  if (normalized.includes("invalid")) return "invalid";
  return null;
}

function stateMessage(state: SetupState) {
  switch (state) {
    case "checking":
      return {
        title: COPY.checkingTitle,
        description: COPY.checkingDescription,
        tone: "muted" as const,
      };
    case "invalid":
      return {
        title: COPY.invalidTitle,
        description: COPY.invalidDescription,
        tone: "error" as const,
      };
    case "expired":
      return {
        title: COPY.expiredTitle,
        description: COPY.expiredDescription,
        tone: "error" as const,
      };
    case "used":
      return {
        title: COPY.usedTitle,
        description: COPY.usedDescription,
        tone: "warning" as const,
      };
    case "success":
      return {
        title: COPY.successTitle,
        description: COPY.successDescription,
        tone: "success" as const,
      };
    default:
      return null;
  }
}

function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SetupState>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }

    const controller = new AbortController();
    setState("checking");
    setError("");

    fetch("/api/backend/auth/password-setup-token?token=" + encodeURIComponent(token), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(COPY.unableCheck);
        }

        const body = (await response.json()) as {
          status?: PasswordSetupTokenStatus;
        };
        setState(mapTokenStatus(body.status ?? "Invalid"));
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }

        setState("invalid");
      });

    return () => controller.abort();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (state !== "valid") {
      setError(COPY.invalidLink);
      toast.error(COPY.invalidLink);
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      toast.error(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(COPY.mismatch);
      toast.error(COPY.mismatch);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backend/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? COPY.failed);
      }

      setState("success");
      toast.success(COPY.successToast);
      window.setTimeout(() => router.push("/login"), 1200);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : COPY.failed;
      const nextState = mapErrorToState(message);
      if (nextState) {
        setState(nextState);
      }
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const currentMessage = stateMessage(state);
  const showForm = state === "valid";

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <KoochCard className="mx-auto max-w-md" padding="lg" variant="elevated">
        <div className="mb-6 text-right">
          <p className="text-sm font-bold text-primary">{COPY.invitation}</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">{COPY.setPassword}</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{COPY.intro}</p>
        </div>

        {currentMessage && state !== "valid" && (
          <div
            className={[
              "mb-4 rounded-lg border p-4 text-sm leading-7",
              currentMessage.tone === "success" && "border-primary/30 bg-primary/10 text-foreground",
              currentMessage.tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-foreground",
              currentMessage.tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
              currentMessage.tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <p className="font-bold">{currentMessage.title}</p>
            <p className="mt-1">{currentMessage.description}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        {showForm ? (
          <form className="grid gap-4" onSubmit={submit}>
            <KoochField helperText={COPY.passwordHelper} label={COPY.newPassword} required>
              <KoochInput
                dir="ltr"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </KoochField>
            <KoochField label={COPY.confirmPassword} required>
              <KoochInput
                dir="ltr"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </KoochField>
            <KoochButton className="w-full" loading={saving} type="submit">
              {COPY.submit}
            </KoochButton>
          </form>
        ) : (
          state !== "checking" && (
            <Link
              className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              href="/login"
            >
              {COPY.login}
            </Link>
          )
        )}
      </KoochCard>
    </main>
  );
}
