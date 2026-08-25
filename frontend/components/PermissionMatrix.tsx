"use client";

import { KoochCard } from "@/components/KoochCard";
import { KoochCheckbox } from "@/components/KoochCheckbox";
import type {
  PermissionAction,
  PermissionMatrixValue,
  PropertyPermissionActionMetadata,
  PropertyPermissionGroupMetadata,
} from "@/lib/owner-api";

export function PermissionMatrix({
  actions,
  disabled = false,
  groups,
  isActionDisabled,
  onChange,
  value,
}: {
  actions: PropertyPermissionActionMetadata[];
  disabled?: boolean;
  groups: PropertyPermissionGroupMetadata[];
  isActionDisabled?: (group: string, action: PermissionAction) => boolean;
  onChange: (value: PermissionMatrixValue) => void;
  value: PermissionMatrixValue;
}) {
  function update(group: string, action: PermissionAction, checked: boolean) {
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
          <thead className="bg-muted text-xs font-bold text-muted-foreground">
            <tr>
              <th className="border-b border-border px-4 py-3">بخش</th>
              {actions.map((action) => (
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
            {groups.map((group) => (
              <tr className="hover:bg-muted/70" key={group.key}>
                <th className="px-4 py-3 text-right font-bold text-foreground">
                  {group.label}
                </th>
                {actions.map((action) => {
                  const supported = group.supportedActions.includes(action.key);
                  return (
                    <td className="px-4 py-3 text-center" key={action.key}>
                      {supported ? (
                        <KoochCheckbox
                          checked={Boolean(value[group.key]?.[action.key])}
                          disabled={
                            disabled ||
                            isActionDisabled?.(group.key, action.key)
                          }
                          onChange={(event) =>
                            update(group.key, action.key, event.target.checked)
                          }
                          wrapperClassName="justify-center"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </KoochCard>
  );
}
