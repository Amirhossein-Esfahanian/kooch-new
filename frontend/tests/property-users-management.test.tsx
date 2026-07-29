import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PermissionActions,
  PermissionMatrixValue,
  PropertyPermissionMetadataResponse,
  PropertyUserCandidateResponse,
  PropertyUserResponse,
  PropertyUserRole,
} from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const authSession = vi.hoisted(() => ({
  refreshSession: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    platformRole: "SuperAdmin",
    refreshSession: authSession.refreshSession,
    user: { userId: 1 },
  }),
}));

vi.mock("sonner", () => ({
  toast: notifications,
}));

import { PropertyUsersManagement } from "@/components/property-users/PropertyUsersManagement";

const allPermissions: PermissionActions = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
};

const noPermissions: PermissionActions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
};

function matrix(actions: PermissionActions): PermissionMatrixValue {
  return { Users: { ...actions } };
}

const roleDefaults = Object.fromEntries(
  [
    "PropertyOwner",
    "Manager",
    "Reception",
    "Accounting",
    "Housekeeping",
    "Custom",
  ].map((role) => [role, matrix(role === "Reception" ? noPermissions : allPermissions)]),
) as Record<PropertyUserRole, PermissionMatrixValue>;

const permissionMetadata: PropertyPermissionMetadataResponse = {
  groups: [
    {
      key: "Users",
      label: "Users",
      supportedActions: ["view", "create", "edit", "delete", "export"],
    },
  ],
  actions: [
    { key: "view", label: "View" },
    { key: "create", label: "Create" },
    { key: "edit", label: "Edit" },
    { key: "delete", label: "Delete" },
    { key: "export", label: "Export" },
  ],
  roleDefaults,
  actorAssignablePermissions: matrix(allPermissions),
};

function savedMember(
  fullName: string,
  role: PropertyUserRole,
): PropertyUserResponse {
  return {
    id: 20,
    userId: 9,
    propertyId: 10,
    fullName,
    mobile: "09121234567",
    email: "",
    username: "",
    status: "Pending",
    role,
    isActive: false,
    passwordSetupRequired: true,
    canRemove: true,
    permissions: roleDefaults[role],
  };
}

function renderFlow(
  candidate: PropertyUserCandidateResponse,
  created = savedMember("Created Member", "Manager"),
) {
  ownerApi.apiRequest.mockImplementation(
    (path: string, options?: RequestInit) => {
      if (path === "/owner/properties/10") {
        return Promise.resolve({ name: "Test Property" });
      }
      if (path === "/owner/properties/10/users" && !options) {
        return Promise.resolve([]);
      }
      if (path === "/owner/properties/10/users/permission-metadata") {
        return Promise.resolve(permissionMetadata);
      }
      if (path === "/owner/properties/10/users/resolve") {
        return Promise.resolve(candidate);
      }
      if (
        path === "/owner/properties/10/users" &&
        options?.method === "POST"
      ) {
        return Promise.resolve(created);
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    },
  );

  render(<PropertyUsersManagement context="owner" propertyId={10} />);
}

async function openCreateFlow() {
  const openButton = await screen.findByRole("button");
  fireEvent.click(openButton);
  await screen.findByRole("dialog");
}

function submitCreateForm() {
  const form = document.getElementById("property-user-form");
  expect(form).toBeTruthy();
  fireEvent.submit(form!);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PropertyUsersManagement creation flow", () => {
  it("creates membership for an existing user and refreshes the visible list", async () => {
    renderFlow(
      {
        outcome: "CanContinue",
        requiresUserCreation: false,
        maskedName: "M*** R***",
      },
      savedMember("Existing Member", "Manager"),
    );
    await openCreateFlow();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "09121234567" },
    });
    submitCreateForm();

    expect(await screen.findByText("M*** R***")).toBeTruthy();
    submitCreateForm();

    expect(await screen.findByText("Existing Member")).toBeTruthy();
    const createCall = ownerApi.apiRequest.mock.calls.find(
      ([path, options]) =>
        path === "/owner/properties/10/users" && options?.method === "POST",
    );
    expect(JSON.parse(createCall![1].body as string)).toMatchObject({
      fullName: null,
      email: null,
      mobile: "09121234567",
      role: "Manager",
      permissions: roleDefaults.Manager,
    });
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, options]) =>
          path === "/owner/properties/10/users" && !options,
      ),
    ).toHaveLength(1);
    expect(notifications.success).toHaveBeenCalledOnce();
  });

  it("collects a new identity and applies the selected role defaults", async () => {
    renderFlow(
      {
        outcome: "CanContinue",
        requiresUserCreation: true,
        maskedName: null,
      },
      savedMember("New Member", "Reception"),
    );
    await openCreateFlow();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "09121234567" },
    });
    submitCreateForm();

    await waitFor(() =>
      expect(document.getElementById("property-user-first-name")).toBeTruthy(),
    );
    const firstName = document.getElementById("property-user-first-name");
    fireEvent.change(firstName!, { target: { value: "New" } });
    fireEvent.change(document.getElementById("property-user-last-name")!, {
      target: { value: "Member" },
    });
    fireEvent.change(document.getElementById("property-user-email")!, {
      target: { value: "new@example.test" },
    });
    submitCreateForm();

    const roleSelect = await screen.findAllByRole("combobox");
    fireEvent.change(roleSelect[0], { target: { value: "Reception" } });
    submitCreateForm();

    expect(await screen.findByText("New Member")).toBeTruthy();
    const createCall = ownerApi.apiRequest.mock.calls.find(
      ([path, options]) =>
        path === "/owner/properties/10/users" && options?.method === "POST",
    );
    expect(JSON.parse(createCall![1].body as string)).toMatchObject({
      fullName: "New Member",
      email: "new@example.test",
      mobile: "09121234567",
      role: "Reception",
      permissions: roleDefaults.Reception,
    });
  });

  it.each([
    ["Unavailable", "unavailable"],
    ["AlreadyMember", "already member"],
  ] as const)("keeps the dialog in lookup for %s candidates", async (outcome, _label) => {
    renderFlow({
      outcome,
      requiresUserCreation: false,
      maskedName: null,
    });
    await openCreateFlow();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "09121234567" },
    });
    submitCreateForm();

    await waitFor(() => expect(notifications.error).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/owner/properties/10/users" && options?.method === "POST",
      ),
    ).toBe(false);
  });
});
