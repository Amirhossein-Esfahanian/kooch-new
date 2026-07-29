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
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  apiRequest,
  ApiRequestError,
  clearToken,
  getToken,
} from "@/lib/owner-api";
import {
  getStoredOwnerPropertyId,
  getStoredWorkspace,
  onSessionRevoked,
  setStoredWorkspace,
  type StoredWorkspace,
} from "@/lib/auth-session";

export type AuthWorkspace = StoredWorkspace;
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
  platformPermissions: string[];
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
  platformPermissions?: string[];
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
  platformPermissions: string[];
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
    platformPermissions: response.platformPermissions ?? [],
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
  const requestedAuthorizedWorkspace =
    requestedWorkspace && session.workspaces.includes(requestedWorkspace)
      ? requestedWorkspace
      : null;
  const workspace =
    requestedAuthorizedWorkspace ??
    (session.workspaces.length === 1
      ? session.workspaces[0]
      : getStoredWorkspace(session.workspaces));

  if (!workspace) {
    return session.workspaces.length > 1 ? "/choose-workspace" : "/login";
  }

  if (workspace === "admin") return "/admin";

  if (workspace === "owner") {
    const activeMemberships = session.propertyMemberships.filter(
      (membership) =>
        membership.isActive && membership.membershipStatus === "Active",
    );
    const activePropertyIds = activeMemberships.map(
      (membership) => membership.propertyId,
    );
    const propertyId =
      getStoredOwnerPropertyId(activePropertyIds) ?? activePropertyIds[0] ?? null;

    return propertyId
      ? `/owner/properties/${propertyId}`
      : "/owner/select-property";
  }

  return "/account";
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
        getStoredWorkspace(nextSession.workspaces);
        getStoredOwnerPropertyId(
          nextSession.propertyMemberships
            .filter(
              (membership) =>
                membership.isActive && membership.membershipStatus === "Active",
            )
            .map((membership) => membership.propertyId),
        );

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
          if (!error.sessionRevoked) {
            clearSession();
            if (options.redirectOnUnauthorized) {
              toast.error(error.message);
              router.replace("/login");
            }
          }
          return null;
        }

        setLoading(false);
        throw error;
      }
    },
    [clearSession, router],
  );

  useEffect(
    () =>
      onSessionRevoked(({ message }) => {
        requestIdRef.current += 1;
        setSession(null);
        setLoading(false);
        toast.error(message);
        router.replace("/login");
      }),
    [router],
  );
  useEffect(() => {
    if (!getToken()) {
      setSession(null);
      setLoading(false);
      return;
    }

    void refreshSession().catch(() => undefined);
  }, [refreshSession]);

  useEffect(() => {
    if (!session) return;

    const routeWorkspace: AuthWorkspace | null = pathname.startsWith("/admin")
      ? "admin"
      : pathname.startsWith("/owner")
        ? "owner"
        : pathname.startsWith("/account")
          ? "account"
          : null;

    if (routeWorkspace && session.workspaces.includes(routeWorkspace)) {
      setStoredWorkspace(routeWorkspace);
    }
  }, [pathname, session]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      loading,
      authenticated: session !== null,
      user: session?.user ?? null,
      platformRole: session?.platformRole ?? null,
      platformPermissions: session?.platformPermissions ?? [],
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

