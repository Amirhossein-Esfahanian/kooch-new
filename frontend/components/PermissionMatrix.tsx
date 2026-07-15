"use client";

import { KoochCard } from "@/components/KoochCard";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import type {
  PermissionAction,
  PermissionActions,
  PermissionGroup,
  PermissionMatrixValue,
} from "@/lib/owner-api";

export const permissionGroups: Array<{ key: PermissionGroup; label: string }> = [
  { key: "Dashboard", label: "داشبورد" },
  { key: "Properties", label: "اطلاعات اقامتگاه" },
  { key: "Rooms", label: "اتاق‌ها" },
  { key: "Pricing", label: "قیمت‌گذاری" },
  { key: "Inventory", label: "ظرفیت" },
  { key: "Bookings", label: "رزروها" },
  { key: "Reviews", label: "نظرات" },
  { key: "Users", label: "کاربران اقامتگاه" },
  { key: "Financial", label: "مالی" },
  { key: "Reports", label: "گزارش‌ها" },
  { key: "Settings", label: "تنظیمات اقامتگاه" },
];

export const permissionActions: Array<{
  key: PermissionAction;
  label: string;
}> = [
  { key: "view", label: "مشاهده" },
  { key: "create", label: "ایجاد" },
  { key: "edit", label: "ویرایش" },
  { key: "delete", label: "حذف" },
  { key: "export", label: "خروجی" },
];

const emptyActions: PermissionActions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
};

export function createEmptyPermissionMatrix(): PermissionMatrixValue {
  return permissionGroups.reduce((matrix, group) => {
    matrix[group.key] = { ...emptyActions };
    return matrix;
  }, {} as PermissionMatrixValue);
}

export function createRolePermissionMatrix(role: string): PermissionMatrixValue {
  const matrix = createEmptyPermissionMatrix();

  function allow(
    group: PermissionGroup,
    options: Partial<PermissionActions> = {},
  ) {
    matrix[group] = {
      view: true,
      create: options.create ?? true,
      edit: options.edit ?? true,
      delete: options.delete ?? false,
      export: options.export ?? false,
    };
  }

  if (role === "Manager") {
    permissionGroups.forEach((group) =>
      allow(group.key, {
        delete: !["Financial", "Reports"].includes(group.key),
        export: ["Bookings", "Financial", "Reports"].includes(group.key),
      }),
    );
  } else if (role === "Reception") {
    allow("Dashboard", { create: false, edit: false });
    allow("Rooms");
    allow("Inventory");
    allow("Bookings", { export: true });
    allow("Reviews", { create: false });
  } else if (role === "Accounting") {
    allow("Dashboard", { create: false, edit: false });
    allow("Pricing");
    allow("Financial", { export: true });
    allow("Reports", { create: false, edit: false, export: true });
  } else if (role === "Housekeeping") {
    allow("Dashboard", { create: false, edit: false });
    allow("Rooms", { create: false });
    allow("Inventory", { create: false });
  } else {
    allow("Dashboard", { create: false, edit: false });
  }

  return matrix;
}

export function normalizePermissionMatrix(
  value?: Partial<Record<PermissionGroup, Partial<PermissionActions>>> | null,
): PermissionMatrixValue {
  const matrix = createEmptyPermissionMatrix();
  permissionGroups.forEach((group) => {
    const actions = value?.[group.key];
    matrix[group.key] = {
      view: Boolean(actions?.view),
      create: Boolean(actions?.create),
      edit: Boolean(actions?.edit),
      delete: Boolean(actions?.delete),
      export: Boolean(actions?.export),
    };
  });
  return matrix;
}

export function PermissionMatrix({
  disabled = false,
  isActionDisabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  isActionDisabled?: (group: PermissionGroup, action: PermissionAction) => boolean;
  onChange: (value: PermissionMatrixValue) => void;
  value: PermissionMatrixValue;
}) {
  function update(group: PermissionGroup, action: PermissionAction, checked: boolean) {
    onChange({
      ...value,
      [group]: {
        ...value[group],
        [action]: checked,
      },
    });
  }

  return (
    <KoochCard className="overflow-hidden" padding="none" variant="muted">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-right text-sm">
          <thead className="bg-muted text-xs font-black text-muted-foreground">
            <tr>
              <th className="border-b border-border px-4 py-3">بخش</th>
              {permissionActions.map((action) => (
                <th
                  className="border-b border-border px-4 py-3 text-center"
                  key={action.key}
                >
                  {action.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {permissionGroups.map((group) => (
              <tr className="hover:bg-muted/70" key={group.key}>
                <th className="px-4 py-3 text-right font-black text-foreground">
                  {group.label}
                </th>
                {permissionActions.map((action) => (
                  <td className="px-4 py-3 text-center" key={action.key}>
                    <KoochCheckbox
                      checked={Boolean(value[group.key]?.[action.key])}
                      disabled={disabled || isActionDisabled?.(group.key, action.key)}
                      onChange={(event) =>
                        update(group.key, action.key, event.target.checked)
                      }
                      wrapperClassName="justify-center"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </KoochCard>
  );
}
