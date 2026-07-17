"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import type {
  AuthPropertyMembership,
  PropertyPermissionMatrix,
} from "@/components/auth/AuthSessionProvider";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { ownerPropertyKey } from "@/lib/owner-api";

export interface SwitchPropertyOptions {
  replace?: boolean;
}

export interface OwnerPropertyContextValue {
  propertyId: number | null;
  propertyName: string | null;
  membership: AuthPropertyMembership | null;
  effectivePermissions: PropertyPermissionMatrix | null;
  activeMemberships: AuthPropertyMembership[];
  routePropertyIsValid: boolean;
  switchProperty: (
    propertyId: number,
    options?: SwitchPropertyOptions,
  ) => void;
}

const OwnerPropertyContext = createContext<OwnerPropertyContextValue | null>(
  null,
);

export function OwnerPropertyProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string | string[] }>();
  const pathname = usePathname();
  const router = useRouter();
  const {
    authenticated,
    defaultPropertyId,
    loading,
    propertyMemberships,
    workspaces,
  } = useAuthSession();
  const [preferredPropertyId, setPreferredPropertyId] = useState<number | null>(
    null,
  );
  const [pendingPropertyId, setPendingPropertyId] = useState<number | null>(
    null,
  );
  const activeMemberships = useMemo(
    () =>
      propertyMemberships.filter(
        (membership) =>
          membership.isActive && membership.membershipStatus === "Active",
      ),
    [propertyMemberships],
  );
  const routePathId = pathname.match(/^\/owner\/properties\/([^/]+)/)?.[1];
  const routeRequestsProperty = Boolean(routePathId && routePathId !== "new");
  const routeParam =
    (Array.isArray(params.id) ? params.id[0] : params.id) ?? routePathId;
  const parsedRoutePropertyId = Number(routeParam);
  const routePropertyId =
    routeRequestsProperty &&
    Number.isInteger(parsedRoutePropertyId) &&
    parsedRoutePropertyId > 0
      ? parsedRoutePropertyId
      : null;
  const routeMembership = activeMemberships.find(
    (membership) => membership.propertyId === routePropertyId,
  );
  const routePropertyIsValid =
    !routeRequestsProperty || Boolean(routeMembership);
  const defaultMembership = activeMemberships.find(
    (membership) => membership.propertyId === defaultPropertyId,
  );
  const preferredMembership = activeMemberships.find(
    (membership) => membership.propertyId === preferredPropertyId,
  );
  const pendingMembership = activeMemberships.find(
    (membership) => membership.propertyId === pendingPropertyId,
  );
  const membership =
    pendingMembership ??
    (routeRequestsProperty
      ? routeMembership ?? null
      : preferredMembership ??
        defaultMembership ??
        (activeMemberships.length === 1 ? activeMemberships[0] : null));

  useEffect(() => {
    if (loading) return;

    const savedPropertyId = Number(localStorage.getItem(ownerPropertyKey));
    const savedMembership = activeMemberships.find(
      (item) => item.propertyId === savedPropertyId,
    );

    setPreferredPropertyId(savedMembership?.propertyId ?? null);
    if (!savedMembership) {
      localStorage.removeItem(ownerPropertyKey);
    }
  }, [activeMemberships, loading]);

  useEffect(() => {
    if (!routeMembership) return;

    setPreferredPropertyId(routeMembership.propertyId);
    localStorage.setItem(
      ownerPropertyKey,
      routeMembership.propertyId.toString(),
    );
  }, [routeMembership]);

  useEffect(() => {
    if (pendingPropertyId && routePropertyId === pendingPropertyId) {
      setPendingPropertyId(null);
    }
  }, [pendingPropertyId, routePropertyId]);

  useEffect(() => {
    if (
      loading ||
      !authenticated ||
      !workspaces.includes("owner") ||
      !routeRequestsProperty ||
      routePropertyIsValid
    ) {
      return;
    }

    router.replace(
      defaultMembership
        ? `/owner/properties/${defaultMembership.propertyId}`
        : "/owner/select-property",
    );
  }, [
    authenticated,
    defaultMembership,
    loading,
    routePropertyIsValid,
    routeRequestsProperty,
    router,
    workspaces,
  ]);

  const switchProperty = useCallback(
    (propertyId: number, options: SwitchPropertyOptions = {}) => {
      const nextMembership = activeMemberships.find(
        (item) => item.propertyId === propertyId,
      );
      if (!nextMembership) {
        router.push("/owner/select-property");
        return;
      }

      setPendingPropertyId(propertyId);
      setPreferredPropertyId(propertyId);
      localStorage.setItem(ownerPropertyKey, propertyId.toString());
      const destination = `/owner/properties/${propertyId}`;
      if (options.replace) {
        router.replace(destination);
      } else {
        router.push(destination);
      }
    },
    [activeMemberships, router],
  );

  const value = useMemo<OwnerPropertyContextValue>(
    () => ({
      propertyId: membership?.propertyId ?? null,
      propertyName: membership?.propertyName ?? null,
      membership: membership ?? null,
      effectivePermissions: membership?.effectivePermissions ?? null,
      activeMemberships,
      routePropertyIsValid,
      switchProperty,
    }),
    [activeMemberships, membership, routePropertyIsValid, switchProperty],
  );

  return (
    <OwnerPropertyContext.Provider value={value}>
      {children}
    </OwnerPropertyContext.Provider>
  );
}

export function useOwnerProperty() {
  const context = useContext(OwnerPropertyContext);
  if (!context) {
    throw new Error("useOwnerProperty must be used within OwnerPropertyProvider.");
  }

  return context;
}
