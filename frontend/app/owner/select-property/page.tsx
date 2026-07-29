"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import {
  apiRequest,
  ApiRequestError,
  PropertyResponse,
} from "@/lib/owner-api";

export default function SelectOwnerPropertyPage() {
  const router = useRouter();
  const refreshAttemptedRef = useRef(false);
  const session = useAuthSession();
  const {
    authenticated,
    loading: sessionLoading,
    refreshSession,
    workspaces,
  } = session;
  const { activeMemberships, switchProperty } = useOwnerProperty();
  const hasOwnerWorkspace = workspaces.includes("owner");
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sessionLoading) return;

    if (!authenticated) {
      if (!refreshAttemptedRef.current) {
        refreshAttemptedRef.current = true;
        void refreshSession({ redirectOnUnauthorized: true }).catch(() => {
          router.replace("/login");
        });
      }
      return;
    }

    refreshAttemptedRef.current = false;
    if (!hasOwnerWorkspace) {
      router.replace(resolveSessionDestination(session));
      return;
    }

    if (activeMemberships.length === 0) {
      router.replace(
        resolveSessionDestination({
          ...session,
          workspaces: workspaces.filter((workspace) => workspace !== "owner"),
        }),
      );
      return;
    }

    if (activeMemberships.length === 1) {
      const propertyId = activeMemberships[0].propertyId;
      switchProperty(propertyId, { replace: true });
      return;
    }

    const activePropertyIds = new Set(
      activeMemberships.map((membership) => membership.propertyId),
    );
    let cancelled = false;
    setPropertiesLoading(true);
    setError("");
    apiRequest<PropertyResponse[]>("/owner/properties")
      .then((items) => {
        if (!cancelled) {
          setProperties(
            items.filter((property) => activePropertyIds.has(property.id)),
          );
        }
      })
      .catch((caught: Error) => {
        if (cancelled) return;
        if (caught instanceof ApiRequestError && caught.status === 401) {
          void refreshSession({ redirectOnUnauthorized: true });
          return;
        }
        setError(caught.message);
      })
      .finally(() => {
        if (!cancelled) setPropertiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeMemberships,
    authenticated,
    hasOwnerWorkspace,
    refreshSession,
    router,
    session,
    sessionLoading,
    switchProperty,
    workspaces,
  ]);

  function selectProperty(property: PropertyResponse) {
    switchProperty(property.id);
  }

  if (
    sessionLoading ||
    !authenticated ||
    !hasOwnerWorkspace ||
    activeMemberships.length < 2
  ) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center px-5 text-sm font-semibold text-muted-foreground"
        role="status"
      >
        در حال بررسی دسترسی...
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8" dir="rtl">
      <div className="mb-8">
        <p className="text-sm font-black text-blue-700">انتخاب اقامتگاه</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">
          کدام اقامتگاه را مدیریت می‌کنید؟
        </h1>
      </div>
      {propertiesLoading && (
        <p className="rounded-lg border bg-white p-5 text-slate-500">
          در حال بارگذاری...
        </p>
      )}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      {!propertiesLoading && properties.length === 0 && (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-500">
            هنوز اقامتگاهی برای شما ثبت نشده است.
          </p>
          <Link
            className="hidden"
            href="/owner/properties/new"
          >
            افزودن اقامتگاه جدید
          </Link>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {properties.map((property) => (
          <button
            className="rounded-lg border border-slate-200 bg-white p-5 text-right shadow-sm hover:border-blue-300"
            key={property.id}
            onClick={() => selectProperty(property)}
            type="button"
          >
            <span className="text-xl font-black text-slate-950">
              {property.name}
            </span>
            <span className="mt-2 block text-sm text-slate-500">
              {property.city} · {property.status}
            </span>
            <span className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              ورود به پنل
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
