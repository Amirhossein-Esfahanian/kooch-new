import type { PropertyPermissionMatrix } from "@/components/auth/AuthSessionProvider";
import type { PermissionGroup } from "@/lib/owner-api";

export function canViewOwnerMenuItem(
  permissions: PropertyPermissionMatrix | null | undefined,
  permission: PermissionGroup,
) {
  if (permission === "Dashboard") return true;
  return Boolean(permissions?.[permission]?.view);
}
