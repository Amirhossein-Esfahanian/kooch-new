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
import {
  normalizeIranMobileInput,
  validateIranMobile,
} from "@/lib/iran-mobile";

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
  it("normalizes Persian and Arabic mobile digits to the canonical UI format", () => {
    expect(normalizeIranMobileInput("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
    expect(normalizeIranMobileInput("٠٩١٢٣٤٥٦٧٨٩")).toBe("09123456789");
    expect(normalizeIranMobileInput("09a12-345 67890")).toBe("09123456789");
  });

  it("validates the canonical Iranian mobile shape", () => {
    expect(validateIranMobile("09123456789")).toBe("");
    expect(validateIranMobile("0912345678")).not.toBe("");
    expect(validateIranMobile("091234567890")).not.toBe("");
    expect(validateIranMobile("08123456789")).not.toBe("");
    expect(validateIranMobile("09123a56789")).not.toBe("");
  });

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
    expect(screen.getByText("شماره موبایل الزامی است.")).toBeTruthy();
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

  it("normalizes mobile input and exposes numeric input constraints", () => {
    const { container } = render(<IdentityHarness />);
    const mobileInput = container.querySelector<HTMLInputElement>(
      "#test-user-mobile",
    )!;

    expect(mobileInput.inputMode).toBe("numeric");
    expect(mobileInput.maxLength).toBe(11);

    fireEvent.change(mobileInput, {
      target: { value: "۰۹۱۲۳۴۵۶۷۸۹" },
    });

    expect(mobileInput.value).toBe("09123456789");
    expect(screen.getByTestId("identity-value").textContent).toContain(
      '"mobile":"09123456789"',
    );
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
