import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  CreateUserFields,
  getCreateUserApiError,
  hasCreateUserIdentityErrors,
  validateCreateUserIdentity,
  type CreateUserIdentity,
} from "@/components/users/CreateUserFields";

const emptyIdentity: CreateUserIdentity = {
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
};

function IdentityHarness({
  errors = {},
}: {
  errors?: ReturnType<typeof validateCreateUserIdentity>;
}) {
  const [value, setValue] = useState(emptyIdentity);

  return (
    <>
      <CreateUserFields
        errors={errors}
        idPrefix="test-user"
        onChange={setValue}
        value={value}
      />
      <output data-testid="identity-value">{JSON.stringify(value)}</output>
    </>
  );
}

describe("CreateUserFields", () => {
  it("accepts a complete identity without email", () => {
    const errors = validateCreateUserIdentity({
      firstName: "علی",
      lastName: "رضایی",
      mobile: "09121234567",
      email: "",
    });

    expect(errors).toEqual({});
    expect(hasCreateUserIdentityErrors(errors)).toBe(false);
  });

  it("shows shared validation errors and validates an optional email when present", () => {
    const errors = validateCreateUserIdentity({
      ...emptyIdentity,
      email: "invalid-email",
    });

    render(<IdentityHarness errors={errors} />);

    expect(screen.getByText("نام را وارد کنید.")).toBeTruthy();
    expect(screen.getByText("نام خانوادگی را وارد کنید.")).toBeTruthy();
    expect(screen.getByText("شماره موبایل را وارد کنید.")).toBeTruthy();
    expect(screen.getByText("ایمیل واردشده معتبر نیست.")).toBeTruthy();
  });

  it("updates only identity fields and contains no role or permission controls", () => {
    const { container } = render(<IdentityHarness />);

    fireEvent.change(container.querySelector("#test-user-first-name")!, {
      target: { value: "مریم" },
    });
    fireEvent.change(container.querySelector("#test-user-mobile")!, {
      target: { value: "09120000000" },
    });

    expect(screen.getByTestId("identity-value").textContent).toContain("مریم");
    expect(screen.getByTestId("identity-value").textContent).toContain(
      "09120000000",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/نقش|دسترسی|Permission/i)).toBeNull();
  });

  it("maps duplicate identity API errors to canonical Persian messages", () => {
    expect(
      getCreateUserApiError(new Error("Phone number already exists.")),
    ).toBe("این شماره موبایل قبلاً ثبت شده است.");
    expect(getCreateUserApiError(new Error("Duplicate email address."))).toBe(
      "این ایمیل قبلاً ثبت شده است.",
    );
  });

  it("is reused by admin, property membership, transfer, and owner candidate flows", () => {
    const root = resolve(process.cwd());
    const sources = [
      readFileSync(resolve(root, "app/admin/users/page.tsx"), "utf8"),
      readFileSync(
        resolve(root, "components/property-users/PropertyUsersManagement.tsx"),
        "utf8",
      ),
      readFileSync(resolve(root, "app/admin/properties/page.tsx"), "utf8"),
    ];

    expect(sources[0]).toContain("<CreateUserFields");
    expect(sources[1]).toContain("<CreateUserFields");
    expect(sources[1]).toContain("<PermissionMatrix");
    expect(sources[1]).toContain("roleDefaults[role]");
    expect(sources[2].match(/<CreateUserFields/g)).toHaveLength(2);
    expect(sources[2]).toContain('idPrefix="transfer-owner"');
    expect(sources[2]).toContain('idPrefix="property-owner-candidate"');
  });
});
