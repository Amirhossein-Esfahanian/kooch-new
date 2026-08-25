$ErrorActionPreference = "Stop"

function Read-Normalized([string]$Path) {
    return [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path).Replace("`r`n", "`n")
}

function Write-Source([string]$Path, [string]$Text, [bool]$Bom = $false) {
    [IO.File]::WriteAllText(
        (Resolve-Path -LiteralPath $Path).Path,
        $Text.Replace("`n", "`r`n"),
        [Text.UTF8Encoding]::new($Bom)
    )
}

function Replace-Exact([string]$Text, [string]$Old, [string]$New) {
    if (-not $Text.Contains($Old)) {
        throw "Expected source fragment was not found."
    }
    return $Text.Replace($Old, $New)
}

function Replace-Between(
    [string]$Text,
    [string]$StartMarker,
    [string]$EndMarker,
    [string]$Replacement
) {
    $start = $Text.IndexOf($StartMarker)
    $end = $Text.IndexOf($EndMarker, $start)
    if ($start -lt 0 -or $end -lt 0) {
        throw "Replacement boundary was not found."
    }
    return $Text.Substring(0, $start) + $Replacement + $Text.Substring($end)
}

$fieldsPath = "frontend/components/users/CreateUserFields.tsx"
$fieldsText = Read-Normalized $fieldsPath
$fieldsText = Replace-Exact $fieldsText `
    @'
  idPrefix,
  onChange,
  value,
'@ `
    @'
  idPrefix,
  mobileReadOnly = false,
  onChange,
  value,
'@
$fieldsText = Replace-Exact $fieldsText `
    @'
  idPrefix: string;
  onChange: (value: CreateUserIdentity) => void;
'@ `
    @'
  idPrefix: string;
  mobileReadOnly?: boolean;
  onChange: (value: CreateUserIdentity) => void;
'@
$fieldsText = Replace-Exact $fieldsText `
    @'
          onChange={(event) => update("mobile", event.target.value)}
          required
'@ `
    @'
          onChange={(event) => update("mobile", event.target.value)}
          readOnly={mobileReadOnly}
          required
'@
Write-Source $fieldsPath $fieldsText

$apiPath = "frontend/lib/owner-api.ts"
$apiText = Read-Normalized $apiPath
$apiText = Replace-Exact $apiText `
    'export interface PropertyUserResponse {' `
    @'
export type PropertyUserCandidateOutcome =
  | "CanContinue"
  | "AlreadyMember"
  | "Unavailable";

export interface PropertyUserCandidateResponse {
  outcome: PropertyUserCandidateOutcome;
  requiresUserCreation: boolean;
  maskedName: string | null;
}

export interface PropertyUserResponse {
'@
Write-Source $apiPath $apiText

$componentPath = "frontend/components/property-users/PropertyUsersManagement.tsx"
$componentText = Read-Normalized $componentPath

$componentText = Replace-Exact $componentText `
    @'
  PropertyResponse,
  PropertyUserResponse,
'@ `
    @'
  PropertyResponse,
  PropertyUserCandidateResponse,
  PropertyUserResponse,
'@

$componentText = Replace-Exact $componentText `
    @'
type PropertyUserForm = {
'@ `
    @'
type PropertyUserCreateStep = "lookup" | "identity" | "membership";

type PropertyUserForm = {
'@

$componentText = Replace-Exact $componentText `
    @'
  const [identityErrors, setIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
'@ `
    @'
  const [identityErrors, setIdentityErrors] =
    useState<CreateUserIdentityErrors>({});
  const [createStep, setCreateStep] =
    useState<PropertyUserCreateStep>("lookup");
  const [candidateRequiresCreation, setCandidateRequiresCreation] =
    useState(false);
  const [candidateMaskedName, setCandidateMaskedName] = useState("");
'@

$componentText = Replace-Exact $componentText `
    @'
    setIdentityErrors({});
    setForm({
'@ `
    @'
    setIdentityErrors({});
    setCreateStep("lookup");
    setCandidateRequiresCreation(false);
    setCandidateMaskedName("");
    setForm({
'@

$submitStart = @'
  async function submit(event: FormEvent<HTMLFormElement>) {
'@
$changeStatusStart = @'
  async function changeUserStatus(
'@
$newSubmit = @'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingUser && createStep === "lookup") {
      if (!form.mobile.trim()) {
        const message = "شماره موبایل را وارد کنید.";
        setIdentityErrors({ mobile: message });
        toast.error(message);
        return;
      }

      setSaving(true);
      setError("");
      try {
        const candidate = await apiRequest<PropertyUserCandidateResponse>(
          `${apiBase}/resolve`,
          {
            method: "POST",
            body: JSON.stringify({ mobile: form.mobile }),
          },
        );

        if (candidate.outcome === "AlreadyMember") {
          const message = "این کاربر قبلاً عضو همین اقامتگاه است.";
          setError(message);
          toast.error(message);
          return;
        }

        if (candidate.outcome === "Unavailable") {
          const message = "عملیات قابل انجام نیست.";
          setError(message);
          toast.error(message);
          return;
        }

        setCandidateRequiresCreation(candidate.requiresUserCreation);
        setCandidateMaskedName(candidate.maskedName ?? "");
        setIdentityErrors({});
        setCreateStep(
          candidate.requiresUserCreation ? "identity" : "membership",
        );
      } catch (caught) {
        const message = getCreateUserApiError(
          caught,
          "بررسی شماره موبایل انجام نشد.",
        );
        setError(message);
        toast.error(message);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!editingUser && createStep === "identity") {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: form.firstName,
        lastName: form.lastName,
        mobile: form.mobile,
        email: form.email,
      });
      setIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        const message = Object.values(nextIdentityErrors)[0]!;
        setError(message);
        toast.error(message);
        return;
      }

      setCreateStep("membership");
      return;
    }

    if (editingUser) {
      const nextIdentityErrors = validateCreateUserIdentity({
        firstName: form.firstName,
        lastName: form.lastName,
        mobile: form.mobile,
        email: form.email,
      });
      setIdentityErrors(nextIdentityErrors);
      if (hasCreateUserIdentityErrors(nextIdentityErrors)) {
        const message = Object.values(nextIdentityErrors)[0]!;
        setError(message);
        toast.error(message);
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      if (!canManageRole(form.role)) {
        hierarchyError("شما نمی‌توانید این نقش را برای کاربر تنظیم کنید.");
        return;
      }
      if (editingUser && !canManageRole(editingUser.role)) {
        hierarchyError("شما نمی‌توانید کاربری با نقش بالاتر را ویرایش کنید.");
        return;
      }

      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
      const body = editingUser
        ? {
            fullName,
            mobile: form.mobile,
            email: form.email.trim() || null,
            username: form.username || null,
            role: form.role,
            status: form.status,
            isActive: form.isActive,
            permissions: restrictPermissions(
              form.permissions,
              normalizePermissionMatrix(
                editingUser.permissions,
                permissionMetadata,
              ),
            ),
          }
        : {
            fullName: candidateRequiresCreation ? fullName : null,
            mobile: form.mobile,
            email: candidateRequiresCreation
              ? form.email.trim() || null
              : null,
            username: null,
            role: form.role,
            status: form.status,
            isActive: form.status === "Active",
            permissions: restrictPermissions(form.permissions),
          };
      const saved = await apiRequest<PropertyUserResponse>(
        editingUser
          ? `${apiBase}/${editingUser.userId}`
          : apiBase,
        {
          method: editingUser ? "PUT" : "POST",
          body: JSON.stringify(body),
        },
      );
      setUsers((current) =>
        editingUser
          ? current.map((item) => (item.userId === saved.userId ? saved : item))
          : [...current, saved],
      );
      await refreshSessionAfterSelfChange(saved.userId);
      if (
        !editingUser &&
        saved.temporarySetupLink &&
        process.env.NODE_ENV !== "production"
      ) {
        setSetupLink(saved.temporarySetupLink);
      }
      setDialogOpen(false);
      toast.success(
        editingUser ? "کاربر اقامتگاه ذخیره شد" : "عضویت کاربر ثبت شد",
      );
    } catch (caught) {
      const message = getCreateUserApiError(
        caught,
        "ذخیره کاربر انجام نشد.",
      );
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

'@
$componentText = Replace-Between $componentText $submitStart $changeStatusStart $newSubmit

$componentText = Replace-Exact $componentText `
    @'
            <KoochButton form="property-user-form" loading={saving} type="submit">
              ذخیره
            </KoochButton>
'@ `
    @'
            <KoochButton form="property-user-form" loading={saving} type="submit">
              {!editingUser && createStep !== "membership" ? "ادامه" : "ذخیره"}
            </KoochButton>
'@

$identityCardStart = @'
          <KoochCard padding="sm" variant="muted">
'@
$formEnd = @'
        </form>
'@
$newFormBody = @'
          {!editingUser && createStep === "lookup" && (
            <KoochCard padding="sm" variant="muted">
              <div className="grid gap-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    افزودن با شماره موبایل
                  </h3>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    فقط امکان افزودن به همین اقامتگاه بررسی می‌شود.
                  </p>
                </div>
                <KoochField
                  error={identityErrors.mobile}
                  label="شماره موبایل"
                  required
                >
                  <KoochInput
                    dir="ltr"
                    error={identityErrors.mobile}
                    inputMode="tel"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        mobile: event.target.value,
                      }))
                    }
                    required
                    value={form.mobile}
                  />
                </KoochField>
              </div>
            </KoochCard>
          )}

          {(editingUser || createStep === "identity") && (
            <KoochCard padding="sm" variant="muted">
              <div className="grid gap-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    اطلاعات کاربر
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    مشخصات هویتی حساب جدید را وارد کنید.
                  </p>
                </div>
                <CreateUserFields
                  errors={identityErrors}
                  idPrefix="property-user"
                  mobileReadOnly={!editingUser}
                  onChange={(identity) =>
                    setForm((current) => ({
                      ...current,
                      firstName: identity.firstName,
                      lastName: identity.lastName,
                      mobile: identity.mobile,
                      email: identity.email,
                    }))
                  }
                  value={{
                    firstName: form.firstName,
                    lastName: form.lastName,
                    mobile: form.mobile,
                    email: form.email,
                  }}
                />
              </div>
            </KoochCard>
          )}

          {!editingUser && createStep === "membership" && (
            <KoochCard padding="sm" variant="muted">
              <p className="text-xs font-bold text-muted-foreground">
                کاربر انتخاب‌شده
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {candidateRequiresCreation
                  ? `${form.firstName} ${form.lastName}`.trim()
                  : candidateMaskedName || "کاربر موجود"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                {form.mobile}
              </p>
            </KoochCard>
          )}

          {(editingUser || createStep === "membership") && (
            <>
              <KoochCard padding="sm">
                <div className="grid gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      نقش و سطح دسترسی
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      انتخاب نقش، matrix پیش‌فرض را اعمال می‌کند و سپس می‌توانید مجوزها را ویرایش کنید.
                    </p>
                  </div>
                  <KoochField label="نقش اقامتگاه" required>
                    <KoochSelect
                      onChange={(event) => {
                        const role = event.target
                          .value as PropertyUserForm["role"];
                        setForm((current) => ({
                          ...current,
                          role,
                          permissions: restrictPermissions(
                            permissionMetadata?.roleDefaults[role] ?? {},
                            editingUser
                              ? normalizePermissionMatrix(
                                  editingUser.permissions,
                                  permissionMetadata,
                                )
                              : undefined,
                          ),
                        }));
                      }}
                      value={form.role}
                    >
                      {roleOptions.map((role) => (
                        <option
                          disabled={
                            !availableRoleOptions.some(
                              (item) => item.value === role.value,
                            )
                          }
                          key={role.value}
                          value={role.value}
                        >
                          {role.label}
                        </option>
                      ))}
                    </KoochSelect>
                  </KoochField>

                  <div className="grid gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        سطح دسترسی
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        فقط دسترسی‌های همین اقامتگاه و در محدوده دسترسی‌های فعلی شما قابل واگذاری هستند.
                      </p>
                    </div>
                    <PermissionMatrix
                      actions={permissionMetadata?.actions ?? []}
                      disabled={
                        !hasUserPermission(editingUser ? "edit" : "create")
                      }
                      groups={permissionMetadata?.groups ?? []}
                      isActionDisabled={(group, action) =>
                        !canGrantPermission(group, action)
                      }
                      onChange={(permissions) =>
                        setForm((current) => ({
                          ...current,
                          permissions: restrictPermissions(
                            permissions,
                            editingUser
                              ? normalizePermissionMatrix(
                                  editingUser.permissions,
                                  permissionMetadata,
                                )
                              : undefined,
                          ),
                        }))
                      }
                      value={form.permissions}
                    />
                  </div>
                </div>
              </KoochCard>

              {editingUser && (
                <KoochInput
                  dir="ltr"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  placeholder="نام کاربری"
                  value={form.username}
                />
              )}

              <KoochField label="وضعیت عضویت">
                <KoochSelect
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as PropertyUserStatus,
                      isActive: event.target.value === "Active",
                    }))
                  }
                  value={form.status}
                >
                  {statusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </KoochSelect>
              </KoochField>
            </>
          )}
'@
$componentText = Replace-Between $componentText $identityCardStart $formEnd $newFormBody

Write-Source $componentPath $componentText
