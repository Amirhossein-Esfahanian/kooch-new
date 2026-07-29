export const sessionRevokedCode = "session_revoked";

const tokenKey = "kooch_owner_token";
const userRoleKey = "kooch_user_role";
const userNameKey = "kooch_user_name";
export const workspaceKey = "kooch_workspace";
export const ownerPropertyKey = "kooch_owner_property_id";
export const workspaceValues = ["account", "owner", "admin"] as const;
export type StoredWorkspace = (typeof workspaceValues)[number];

export interface SessionRevokedEvent {
  code: typeof sessionRevokedCode;
  message: string;
}

type SessionRevokedListener = (event: SessionRevokedEvent) => void;

const sessionRevokedMessage =
  "\u0646\u0634\u0633\u062a \u0634\u0645\u0627 \u0645\u0646\u0642\u0636\u06cc \u0634\u062f\u0647 \u0627\u0633\u062a. \u0644\u0637\u0641\u0627\u064b \u062f\u0648\u0628\u0627\u0631\u0647 \u0648\u0627\u0631\u062f \u0634\u0648\u06cc\u062f.";
const listeners = new Set<SessionRevokedListener>();
let sessionRevocationNotified = false;

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  return workspaceValues.includes(value as StoredWorkspace);
}

export function getStoredWorkspace(
  authorizedWorkspaces: readonly StoredWorkspace[],
) {
  if (!canUseBrowserStorage()) return null;

  const storedWorkspace = localStorage.getItem(workspaceKey);
  if (
    !isStoredWorkspace(storedWorkspace) ||
    !authorizedWorkspaces.includes(storedWorkspace)
  ) {
    localStorage.removeItem(workspaceKey);
    return null;
  }

  return storedWorkspace;
}

export function setStoredWorkspace(workspace: StoredWorkspace) {
  if (!canUseBrowserStorage() || !isStoredWorkspace(workspace)) return;
  localStorage.setItem(workspaceKey, workspace);
}

export function getStoredOwnerPropertyId(
  authorizedPropertyIds: readonly number[],
) {
  if (!canUseBrowserStorage()) return null;

  const storedPropertyId = Number(localStorage.getItem(ownerPropertyKey));
  if (
    !Number.isInteger(storedPropertyId) ||
    storedPropertyId <= 0 ||
    !authorizedPropertyIds.includes(storedPropertyId)
  ) {
    localStorage.removeItem(ownerPropertyKey);
    return null;
  }

  return storedPropertyId;
}

export function setStoredOwnerPropertyId(propertyId: number) {
  if (!canUseBrowserStorage() || !Number.isInteger(propertyId) || propertyId <= 0) {
    return;
  }

  localStorage.setItem(ownerPropertyKey, propertyId.toString());
}

export function getToken() {
  return canUseBrowserStorage() ? localStorage.getItem(tokenKey) : null;
}

export function setToken(token: string) {
  if (!canUseBrowserStorage()) return;

  sessionRevocationNotified = false;
  localStorage.setItem(tokenKey, token);
}

export function setAuthUser(role: string, fullName?: string) {
  if (!canUseBrowserStorage()) return;

  localStorage.setItem(userRoleKey, role);
  if (fullName) localStorage.setItem(userNameKey, fullName);
}

export function clearToken() {
  if (!canUseBrowserStorage()) return;

  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userNameKey);
  localStorage.removeItem(workspaceKey);
  localStorage.removeItem(ownerPropertyKey);
  localStorage.removeItem(userRoleKey);
}

export function isSessionRevokedResponse(
  response: Pick<Response, "status" | "headers">,
  body: unknown,
) {
  if (response.status !== 401) return false;

  const headerCode = response.headers.get("X-Kooch-Auth-Error");
  if (headerCode === sessionRevokedCode) return true;

  return (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    (body as { code?: unknown }).code === sessionRevokedCode
  );
}

export function notifySessionRevoked(message = sessionRevokedMessage) {
  if (sessionRevocationNotified) return false;

  sessionRevocationNotified = true;
  clearToken();
  const event: SessionRevokedEvent = {
    code: sessionRevokedCode,
    message,
  };
  listeners.forEach((listener) => listener(event));
  return true;
}

export function onSessionRevoked(listener: SessionRevokedListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSessionRevocationStateForTests() {
  sessionRevocationNotified = false;
  listeners.clear();
}
