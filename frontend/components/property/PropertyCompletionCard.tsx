"use client";

import Link from "next/link";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import type {
  PropertyCompletionResponse,
  PropertyCompletionSectionResponse,
} from "@/lib/owner-api";

type CompletionActionResolver = (
  section: PropertyCompletionSectionResponse,
) => string | undefined;

const healthLabels: Record<PropertyCompletionResponse["healthStatus"], string> =
  {
    Ready: "آماده",
    NeedsAttention: "نیازمند توجه",
    Incomplete: "ناقص",
  };

const healthVariants: Record<
  PropertyCompletionResponse["healthStatus"],
  "success" | "warning" | "destructive"
> = {
  Ready: "success",
  NeedsAttention: "warning",
  Incomplete: "destructive",
};

const sectionStatusLabels: Record<
  PropertyCompletionSectionResponse["status"],
  string
> = {
  Complete: "کامل",
  Incomplete: "ناقص",
  NotStarted: "شروع نشده",
};

function fallbackCompletion(
  completion: PropertyCompletionResponse,
): PropertyCompletionResponse {
  return {
    ...completion,
    healthStatus:
      completion.healthStatus ??
      (completion.completionPercentage >= 90
        ? "Ready"
        : completion.completionPercentage >= 60
          ? "NeedsAttention"
          : "Incomplete"),
    sections: completion.sections ?? [],
    warnings: completion.warnings ?? [],
    canActivate:
      completion.canActivate ?? (completion.missingSections?.length ?? 1) === 0,
  };
}

export function PropertyCompletionCard({
  className = "",
  compact = false,
  completion,
  getActionHref,
  onSectionAction,
  title = "وضعیت تکمیل اقامتگاه",
}: {
  className?: string;
  compact?: boolean;
  completion: PropertyCompletionResponse;
  getActionHref?: CompletionActionResolver;
  onSectionAction?: (section: PropertyCompletionSectionResponse) => void;
  title?: string;
}) {
  const safeCompletion = fallbackCompletion(completion);
  const incompleteSections = safeCompletion.sections.filter(
    (section) => section.status !== "Complete",
  );
  const visibleSections = compact
    ? incompleteSections.slice(0, 3)
    : safeCompletion.sections;

  return (
    <KoochCard
      className={`grid gap-4 ${className}`}
      padding={compact ? "sm" : "md"}
      variant="elevated"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {safeCompletion.completionPercentage}% تکمیل شده
          </p>
        </div>
        <KoochBadge variant={healthVariants[safeCompletion.healthStatus]}>
          {healthLabels[safeCompletion.healthStatus]}
        </KoochBadge>
      </div>

      <div>
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, safeCompletion.completionPercentage))}%`,
            }}
          />
        </div>
      </div>

      {safeCompletion.warnings.length > 0 && !compact && (
        <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-3 text-sm font-semibold text-foreground">
          <p className="font-bold">هشدارها</p>
          <ul className="mt-2 grid gap-1 text-muted-foreground">
            {safeCompletion.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {visibleSections.length > 0 && (
        <div className="grid gap-2">
          {visibleSections.map((section) => {
            const actionHref = getActionHref?.(section);
            return (
              <article
                className="rounded-xl border border-border bg-background p-3"
                key={section.key}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-foreground">
                        {section.label}
                      </p>
                      <KoochBadge
                        variant={
                          section.status === "Complete"
                            ? "success"
                            : section.status === "Incomplete"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {sectionStatusLabels[section.status]}
                      </KoochBadge>
                    </div>
                    {section.missingItems.length > 0 && (
                      <p className="mt-2 text-xs font-semibold leading-6 text-muted-foreground">
                        موارد ناقص: {section.missingItems.join("، ")}
                      </p>
                    )}
                  </div>
                  {section.status !== "Complete" && actionHref && (
                    <Link href={actionHref}>
                      <KoochButton size="sm" variant="outline">
                        تکمیل
                      </KoochButton>
                    </Link>
                  )}
                  {section.status !== "Complete" &&
                    !actionHref &&
                    onSectionAction && (
                      <KoochButton
                        onClick={() => onSectionAction(section)}
                        size="sm"
                        variant="outline"
                      >
                        تکمیل
                      </KoochButton>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {compact && incompleteSections.length > visibleSections.length && (
        <p className="text-xs font-semibold text-muted-foreground">
          {incompleteSections.length - visibleSections.length} بخش ناقص دیگر
        </p>
      )}
    </KoochCard>
  );
}
