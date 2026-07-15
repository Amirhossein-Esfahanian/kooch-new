"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  apiRequest,
  ApiRequestError,
  clearToken,
  getToken,
} from "@/lib/owner-api";

export type AuthWorkspace = "admin" | "owner" | "account";
export type PlatformRole = "SuperAdmin" | "AdminAssistant" | "Client";
export type PropertyRole =
  | "PropertyOwner"
  | "Manager"
  | "Reception"
  | "Accounting"
  | "Housekeeping"
  | "Custom";
export type PropertyMembershipStatus =
  | "Pending"
  | "Active"
  | "Suspended"
  | "Inactive";

export interface PropertyPermissionActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
}

export type PropertyPermissionMatrix = Record<
  string,
  PropertyPermissionActions
>;

export interface AuthPropertyMembership {
  propertyId: number;
  propertyName: string;
  propertyRole: PropertyRole;
  membershipStatus: PropertyMembershipStatus;
  isActive: boolean;
  effectivePermissions: PropertyPermissionMatrix;
}

export interface AuthSessionUser {
  userId: number;
  firstName: string;
  lastName: string;
  guestId: number | null;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  isActive: boolean;
}

export interface AuthSession {
  user: AuthSessionUser;
  platformRole: PlatformRole;
  workspaces: AuthWorkspace[];
  propertyMemberships: AuthPropertyMembership[];
  defaultWorkspace: AuthWorkspace | null;
  defaultPropertyId: number | null;
}

export type WorkspaceRoutingSession = Pick<
  AuthSession,
  | "workspaces"
  | "propertyMemberships"
  | "defaultWorkspace"
  | "defaultPropertyId"
>;

interface CurrentUserResponse extends Omit<AuthSessionUser, "isActive"> {
  platformRole: PlatformRole;
  isActive: boolean;
  workspaces: AuthWorkspace[];
  propertyMemberships: AuthPropertyMembership[];
  defaultWorkspace: AuthWorkspace | null;
  defaultPropertyId: number | null;
}

export interface RefreshSessionOptions {
  redirectOnUnauthorized?: boolean;
}

export interface AuthSessionContextValue {
  loading: boolean;
  authenticated: boolean;
  user: AuthSessionUser | null;
  platformRole: PlatformRole | null;
  workspaces: AuthWorkspace[];
  propertyMemberships: AuthPropertyMembership[];
  defaultWorkspace: AuthWorkspace | null;
  defaultPropertyId: number | null;
  refreshSession: (
    options?: RefreshSessionOptions,
  ) => Promise<AuthSession | null>;
  clearSession: () => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

function toSession(response: CurrentUserResponse): AuthSession {
  return {
    user: {
      userId: response.userId,
      firstName: response.firstName,
      lastName: response.lastName,
      guestId: response.guestId,
      fullName: response.fullName,
      email: response.email,
      phoneNumber: response.phoneNumber,
      isActive: response.isActive,
    },
    platformRole: response.platformRole,
    workspaces: response.workspaces,
    propertyMemberships: response.propertyMemberships,
    defaultWorkspace: response.defaultWorkspace,
    defaultPropertyId: response.defaultPropertyId,
  };
}

export function resolveSessionDestination(
  session: WorkspaceRoutingSession,
  requestedWorkspace?: AuthWorkspace | null,
) {
  const workspace = requestedWorkspace
    ? session.workspaces.includes(requestedWorkspace)
      ? requestedWorkspace
      : null
    : session.defaultWorkspace &&
        session.workspaces.includes(session.defaultWorkspace)
      ? session.defaultWorkspace
      : session.workspaces.includes("admin")
        ? "admin"
        : session.workspaces.includes("owner")
          ? "owner"
          : session.workspaces.includes("account")
            ? "account"
            : null;

  if (workspace === "admin") return "/admin";

  if (workspace === "owner") {
    const activeMemberships = session.propertyMemberships.filter(
      (membership) =>
        membership.isActive && membership.membershipStatus === "Active",
    );
    const defaultMembership = activeMemberships.find(
      (membership) => membership.propertyId === session.defaultPropertyId,
    );
    const propertyId =
      defaultMembership?.propertyId ??
      (activeMemberships.length === 1
        ? activeMemberships[0].propertyId
        : null);

    return propertyId
      ? `/owner/properties/${propertyId}`
      : "/owner/select-property";
  }

  return "/";
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const requestIdRef = useRef(0);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(() => {
    requestIdRef.current += 1;
    clearToken();
    setSession(null);
    setLoading(false);
  }, []);

  const refreshSession = useCallback(
    async (
      options: RefreshSessionOptions = {},
    ): Promise<AuthSession | null> => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);

      try {
        const response = await apiRequest<CurrentUserResponse>("/auth/me");
        const nextSession = toSession(response);

        if (requestId === requestIdRef.current) {
          setSession(nextSession);
          setLoading(false);
        }

        return nextSession;
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return null;
        }

        if (error instanceof ApiRequestError && error.status === 401) {
          clearSession();
          if (options.redirectOnUnauthorized) {
            router.replace("/login");
          }
          return null;
        }

        setLoading(false);
        throw error;
      }
    },
    [clearSession, router],
  );

  useEffect(() => {
    if (!getToken()) {
      setSession(null);
      setLoading(false);
      return;
    }

    void refreshSession().catch(() => undefined);
  }, [refreshSession]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      loading,
      authenticated: session !== null,
      user: session?.user ?? null,
      platformRole: session?.platformRole ?? null,
      workspaces: session?.workspaces ?? [],
      propertyMemberships: session?.propertyMemberships ?? [],
      defaultWorkspace: session?.defaultWorkspace ?? null,
      defaultPropertyId: session?.defaultPropertyId ?? null,
      refreshSession,
      clearSession,
    }),
    [clearSession, loading, refreshSession, session],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider.");
  }

  return context;
}
