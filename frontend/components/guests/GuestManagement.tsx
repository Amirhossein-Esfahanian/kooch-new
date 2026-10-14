"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochCard } from "@/components/KoochCard";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";
import { KoochDialog } from "@/components/KoochDialog";
import {
  KoochField,
  KoochInput,
  KoochSelect,
  KoochTextarea,
} from "@/components/KoochFormControls";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { apiRequest } from "@/lib/owner-api";
import { formatCurrency } from "@/lib/currency";
import { formatDateTime } from "@/lib/account-reservations";

export type GuestResponse = {
  id: number;
  userId?: number | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  mobile: string | null;
  email: string | null;
  nationalCode: string | null;
  passportNumber: string | null;
  nationality: string | null;
  birthDate: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
};

type AdminWalletBalance = {
  currency: string;
  balance: number;
  withdrawableBalance: number;
  nonWithdrawableBalance: number;
  heldBalance: number;
  reservedBalance: number;
};

type WalletTransaction = {
  id: number;
  amount: number;
  direction: "Credit" | "Debit";
  currency: string;
  createdAtUtc: string;
};

type WalletTransactionPage = { items: WalletTransaction[] };

type GuestForm = {
  id: number | null;
  identityMode: "Iranian" | "Foreign";
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  nationalCode: string;
  passportNumber: string;
  nationality: string;
  birthDate: string;
  gender: string;
  address: string;
  notes: string;
};

const emptyForm: GuestForm = {
  id: null,
  identityMode: "Iranian",
  firstName: "",
  lastName: "",
  mobile: "",
  email: "",
  nationalCode: "",
  passportNumber: "",
  nationality: "ایران",
  birthDate: "",
  gender: "",
  address: "",
  notes: "",
};

function buildQuery(basePath: string, search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("query", search.trim());
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function toPayload(form: GuestForm) {
  return {
    firstName: form.firstName.trim() || null,
    lastName: form.lastName.trim() || null,
    mobile: form.mobile.trim() || null,
    email: form.email.trim() || null,
    nationalCode: form.identityMode === "Iranian" ? form.nationalCode.trim() || null : null,
    passportNumber: form.identityMode === "Foreign" ? form.passportNumber.trim() || null : null,
    nationality: form.identityMode === "Iranian" ? "ایران" : form.nationality.trim() || null,
    birthDate: form.birthDate || null,
    gender: form.gender || null,
    address: form.address.trim() || null,
    notes: form.notes.trim() || null,
  };
}

function toForm(guest: GuestResponse): GuestForm {
  const identityMode = guest.passportNumber || (guest.nationality && !["ایران", "Iran", "IR"].includes(guest.nationality))
    ? "Foreign" : "Iranian";
  return {
    id: guest.id,
    identityMode,
    firstName: guest.firstName ?? "",
    lastName: guest.lastName ?? "",
    mobile: guest.mobile ?? "",
    email: guest.email ?? "",
    nationalCode: guest.nationalCode ?? "",
    passportNumber: guest.passportNumber ?? "",
    nationality: identityMode === "Iranian" ? "ایران" : guest.nationality ?? "",
    birthDate: guest.birthDate ?? "",
    gender: guest.gender ?? "",
    address: guest.address ?? "",
    notes: guest.notes ?? "",
  };
}

function normalizeSearch(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("fa-IR");
}

function guestMatchesSearch(guest: GuestResponse, search: string) {
  const term = normalizeSearch(search);
  if (!term) return true;

  return [
    guest.id.toString(),
    guest.firstName,
    guest.lastName,
    guest.fullName,
    guest.mobile,
    guest.email,
    guest.nationalCode,
    guest.passportNumber,
    guest.nationality,
    guest.birthDate,
    guest.gender,
    guest.address,
    guest.notes,
  ].some((value) => normalizeSearch(value).includes(term));
}

export function GuestManagement() {
  const router = useRouter();
  const session = useAuthSession();
  const canViewWallet = session.platformRole === "SuperAdmin" || session.platformPermissions.includes("ManagePayments");
  const [guests, setGuests] = useState<GuestResponse[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<GuestForm>(emptyForm);
  const [walletGuest, setWalletGuest] = useState<GuestResponse | null>(null);
  const walletUserId = walletGuest?.userId ?? null;
  const [walletBalances, setWalletBalances] = useState<AdminWalletBalance[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [walletTransactions, setWalletTransactions] = useState<Record<string, WalletTransaction[]>>({});
  const [walletTransactionsLoading, setWalletTransactionsLoading] = useState(false);
  const [walletTransactionsError, setWalletTransactionsError] = useState("");
  const [walletRefresh, setWalletRefresh] = useState(0);

  useEffect(() => {
    setWalletBalances([]);
    setWalletError("");
    setWalletTransactions({});
    setWalletTransactionsError("");
    if (!walletGuest || !walletUserId || !canViewWallet) {
      setWalletLoading(false);
      setWalletTransactionsLoading(false);
      return;
    }
    let active = true;
    setWalletLoading(true);
    setWalletTransactionsLoading(true);
    void apiRequest<AdminWalletBalance[]>(`/admin/wallet/withdrawals/users/${walletUserId}/balances`)
      .then(async data => {
        if (!active) return;
        setWalletBalances(data);
        setWalletLoading(false);
        try {
          const pages = await Promise.all(data.map(wallet =>
            apiRequest<WalletTransactionPage>(`/admin/wallet/withdrawals/users/${walletUserId}/transactions?currency=${encodeURIComponent(wallet.currency)}&page=1&pageSize=5`)
          ));
          if (active) setWalletTransactions(Object.fromEntries(data.map((wallet, index) => [wallet.currency, pages[index].items])));
        } catch (error) {
          if (active) setWalletTransactionsError(error instanceof Error ? error.message : "تراکنش‌های کیف پول بارگذاری نشدند.");
        } finally {
          if (active) setWalletTransactionsLoading(false);
        }
      })
      .catch(error => { if (active) setWalletError(error instanceof Error ? error.message : "موجودی کیف پول بارگذاری نشد."); })
      .finally(() => { if (active) { setWalletLoading(false); setWalletTransactionsLoading(false); } });
    return () => { active = false; };
  }, [canViewWallet, walletGuest, walletUserId, walletRefresh]);

  const basePath = "/admin/guests";
  const visibleGuests = useMemo(
    () => guests.filter((guest) => guestMatchesSearch(guest, search)),
    [guests, search],
  );

  async function loadGuests(nextSearch = search) {
    setLoading(true);
    try {
      const data = await apiRequest<GuestResponse[]>(
        buildQuery(basePath, nextSearch),
      );
      setGuests(data);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "مهمان‌ها بارگذاری نشدند.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGuests("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  function openCreateDialog() {
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(guest: GuestResponse) {
    setForm(toForm(guest));
    setDialogOpen(true);
  }

  function updateForm(field: keyof GuestForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setIdentityMode(identityMode: GuestForm["identityMode"]) {
    setForm((current) => ({
      ...current,
      identityMode,
      nationalCode: identityMode === "Iranian" ? current.nationalCode : "",
      passportNumber: identityMode === "Foreign" ? current.passportNumber : "",
      nationality: identityMode === "Iranian" ? "ایران" : current.identityMode === "Foreign" ? current.nationality : "",
    }));
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadGuests("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.firstName.trim() && !form.lastName.trim()) {
      toast.error("نام یا نام خانوادگی مهمان را وارد کنید.");
      return;
    }

    if (!form.mobile.trim() && !form.email.trim()) {
      toast.error("شماره موبایل یا ایمیل مهمان را وارد کنید.");
      return;
    }

    if (form.identityMode === "Iranian" && !form.nationalCode.trim()) {
      toast.error("کد ملی مهمان ایرانی الزامی است.");
      return;
    }
    if (form.identityMode === "Foreign" && (!form.nationality.trim() || !form.passportNumber.trim())) {
      toast.error("کشور تابعیت و شماره پاسپورت مهمان خارجی الزامی است.");
      return;
    }

    setSaving(true);
    try {
      const saved = await apiRequest<GuestResponse>(
        form.id ? `${basePath}/${form.id}` : basePath,
        {
          method: form.id ? "PUT" : "POST",
          body: JSON.stringify(toPayload(form)),
        },
      );

      setGuests((current) =>
        form.id
          ? current.map((guest) => (guest.id === saved.id ? saved : guest))
          : [saved, ...current],
      );
      setDialogOpen(false);
      toast.success(form.id ? "مهمان ویرایش شد." : "مهمان اضافه شد.");
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "مهمان ذخیره نشد.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteGuest(guest: GuestResponse) {
    setDeleteLoading(true);
    try {
      await apiRequest<void>(`${basePath}/${guest.id}`, { method: "DELETE" });
      setGuests((current) => current.filter((item) => item.id !== guest.id));
      toast.success("مهمان حذف شد.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "مهمان حذف نشد.");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="grid gap-4" dir="rtl">
      <KoochCard padding="md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form className="flex flex-1 flex-col gap-2 sm:flex-row" onSubmit={handleSearch}>
            <KoochInput
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو بر اساس نام، موبایل، ایمیل، کد ملی یا پاسپورت"
              value={search}
            />
            <KoochButton type="submit" variant="outline">
              جستجو
            </KoochButton>
          </form>

          <KoochButton onClick={openCreateDialog}>افزودن مهمان</KoochButton>
        </div>
      </KoochCard>

      <KoochTable>
        <KoochTableHeader>
          <KoochTableRow>
            <KoochTableHead className="w-14">ردیف</KoochTableHead>
            <KoochTableHead>نام مهمان</KoochTableHead>
            <KoochTableHead>موبایل</KoochTableHead>
            <KoochTableHead>ایمیل</KoochTableHead>
            <KoochTableHead>هویت</KoochTableHead>
            <KoochTableHead>عملیات</KoochTableHead>
          </KoochTableRow>
        </KoochTableHeader>
        <KoochTableBody>
          {loading ? (
            <KoochTableEmpty colSpan={6}>در حال بارگذاری...</KoochTableEmpty>
          ) : visibleGuests.length === 0 ? (
            <KoochTableEmpty colSpan={6}>مهمانی پیدا نشد.</KoochTableEmpty>
          ) : (
            visibleGuests.map((guest, index) => (
              <KoochTableRow key={guest.id}>
                <KoochTableCell className="font-bold text-muted-foreground">
                  {(index + 1).toLocaleString("fa-IR")}
                </KoochTableCell>
                <KoochTableCell className="font-bold">
                  {guest.fullName || `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() || "-"}
                </KoochTableCell>
                <KoochTableCell>{guest.mobile ?? "-"}</KoochTableCell>
                <KoochTableCell>{guest.email ?? "-"}</KoochTableCell>
                <KoochTableCell>
                  {guest.passportNumber
                    ? <>{guest.nationality ?? "-"} · <bdi dir="ltr">{guest.passportNumber}</bdi></>
                    : guest.nationalCode ?? "-"}
                </KoochTableCell>
                <KoochTableCell>
                  <div className="flex flex-wrap gap-2">
                    <KoochButton
                      onClick={() => openEditDialog(guest)}
                      size="sm"
                      variant="outline"
                    >
                      ویرایش
                    </KoochButton>
                    {canViewWallet && <KoochButton onClick={() => setWalletGuest(guest)} size="sm" variant="outline" aria-label={`کیف پول ${guest.fullName || `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() || "مهمان"}`}>
                      کیف پول
                    </KoochButton>}
                    <KoochConfirmDialog
                      cancelText="انصراف"
                      confirmText="حذف"
                      description="این مهمان به صورت نرم حذف می‌شود و از لیست فعال خارج خواهد شد."
                      loading={deleteLoading}
                      onConfirm={() => deleteGuest(guest)}
                      title="حذف مهمان"
                      trigger={
                        <KoochButton size="sm" variant="destructive">
                          حذف
                        </KoochButton>
                      }
                      variant="destructive"
                    />
                  </div>
                </KoochTableCell>
              </KoochTableRow>
            ))
          )}
        </KoochTableBody>
      </KoochTable>

      <KoochDialog
        footer={
          <>
            <KoochButton
              disabled={saving}
              onClick={() => setDialogOpen(false)}
              variant="outline"
            >
              انصراف
            </KoochButton>
            <KoochButton
              form="guest-management-form"
              loading={saving}
              type="submit"
            >
              ذخیره
            </KoochButton>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        title={form.id ? "ویرایش مهمان" : "افزودن مهمان"}
      >
        <form
          className="grid gap-4"
          id="guest-management-form"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-4 md:grid-cols-2">
              <KoochField label="نام" required>
                <KoochInput
                  onChange={(event) => updateForm("firstName", event.target.value)}
                  value={form.firstName}
                />
              </KoochField>
              <KoochField label="نام خانوادگی" required>
                <KoochInput
                  onChange={(event) => updateForm("lastName", event.target.value)}
                  value={form.lastName}
                />
              </KoochField>
              <KoochField label="موبایل">
                <KoochInput
                  inputMode="tel"
                  onChange={(event) => updateForm("mobile", event.target.value)}
                  value={form.mobile}
                />
              </KoochField>
              <KoochField label="ایمیل">
                <KoochInput
                  dir="ltr"
                  onChange={(event) => updateForm("email", event.target.value)}
                  type="email"
                  value={form.email}
                />
              </KoochField>
              <KoochField label="نوع هویت" required>
                <KoochSelect value={form.identityMode} onChange={(event) => setIdentityMode(event.target.value as GuestForm["identityMode"])}>
                  <option value="Iranian">ایرانی</option>
                  <option value="Foreign">خارجی</option>
                </KoochSelect>
              </KoochField>
              {form.identityMode === "Iranian" ? (
                <KoochField label="کد ملی" required>
                  <KoochInput inputMode="numeric" required onChange={(event) => updateForm("nationalCode", event.target.value)} value={form.nationalCode} />
                </KoochField>
              ) : (
                <>
                  <KoochField label="کشور تابعیت" required>
                    <KoochInput required onChange={(event) => updateForm("nationality", event.target.value)} value={form.nationality} />
                  </KoochField>
                  <KoochField label="شماره پاسپورت" required>
                    <KoochInput dir="ltr" required onChange={(event) => updateForm("passportNumber", event.target.value)} value={form.passportNumber} />
                  </KoochField>
                </>
              )}
              <KoochField label="تاریخ تولد">
                <KoochInput
                  onChange={(event) => updateForm("birthDate", event.target.value)}
                  type="date"
                  value={form.birthDate}
                />
              </KoochField>
              <KoochField label="جنسیت">
                <KoochSelect
                  onChange={(event) => updateForm("gender", event.target.value)}
                  value={form.gender}
                >
                  <option value="">انتخاب نشده</option>
                  <option value="Female">زن</option>
                  <option value="Male">مرد</option>
                  <option value="Other">سایر</option>
                </KoochSelect>
              </KoochField>
          </div>

            <KoochField label="آدرس">
              <KoochTextarea
                onChange={(event) => updateForm("address", event.target.value)}
                rows={3}
                value={form.address}
              />
            </KoochField>

            <KoochField label="یادداشت">
              <KoochTextarea
                onChange={(event) => updateForm("notes", event.target.value)}
                rows={3}
                value={form.notes}
              />
            </KoochField>
        </form>
      </KoochDialog>

      <KoochDialog open={walletGuest !== null} onOpenChange={open => { if (!open) setWalletGuest(null); }} title="کیف پول مهمان" size="sm">
        {walletGuest && <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            مهمان: <strong className="text-foreground">{walletGuest.fullName || `${walletGuest.firstName ?? ""} ${walletGuest.lastName ?? ""}`.trim() || "—"}</strong>
            {walletGuest.mobile && <> · <bdi dir="ltr">{walletGuest.mobile}</bdi></>}
          </p>
          <section aria-label="خلاصه کیف پول" className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-foreground">خلاصه کیف پول</h3>
              {walletUserId !== null && <KoochButton size="sm" variant="outline" onClick={() => router.push(`/admin/wallet/withdrawals?userId=${walletUserId}`)}>ثبت درخواست برداشت</KoochButton>}
            </div>
            {walletLoading ? <p role="status" className="text-sm text-muted-foreground">در حال دریافت موجودی کیف پول...</p> :
              walletError ? <p role="alert" className="text-sm text-destructive">{walletError} <KoochButton size="sm" variant="outline" onClick={() => setWalletRefresh(value => value + 1)}>تلاش دوباره</KoochButton></p> :
              walletBalances.length === 0 ? <p className="text-sm text-muted-foreground">{walletUserId ? "کیف پولی برای این کاربر ثبت نشده است." : "این مهمان به حساب کاربری متصل نیست؛ کیف پولی برای نمایش وجود ندارد."}</p> :
              <div className="grid gap-3">
                {walletBalances.map(wallet => (
                  <div key={wallet.currency} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                    <h4 className="font-semibold text-foreground">واحد پول: <bdi dir="ltr">{wallet.currency}</bdi></h4>
                    <dl className="grid gap-2">
                      {([
                        ["قابل استفاده", wallet.balance],
                        ["قابل برداشت", wallet.withdrawableBalance],
                        ["غیرقابل برداشت", wallet.nonWithdrawableBalance],
                        ["در نگه‌داشت", wallet.heldBalance],
                        ["رزروشده برای برداشت", wallet.reservedBalance],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="flex items-baseline justify-between gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="font-semibold tabular-nums text-foreground">{formatCurrency(value, { showCurrency: false })} <bdi dir="ltr">{wallet.currency}</bdi></dd>
                        </div>
                      ))}
                    </dl>
                    <div className="border-t border-border pt-3">
                      <h5 className="mb-2 font-semibold text-foreground">تراکنش‌های اخیر</h5>
                      {walletTransactionsLoading ? <p role="status" className="text-muted-foreground">در حال بارگذاری تراکنش‌ها...</p> :
                        walletTransactionsError ? <p role="alert" className="text-destructive">{walletTransactionsError} <KoochButton size="sm" variant="outline" onClick={() => setWalletRefresh(value => value + 1)}>تلاش دوباره</KoochButton></p> :
                        !walletTransactions[wallet.currency]?.length ? <p className="text-muted-foreground">هنوز تراکنشی در این کیف پول ثبت نشده است.</p> :
                        <ul className="divide-y divide-border">
                          {walletTransactions[wallet.currency].map(transaction => (
                            <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span className="flex items-center gap-2">
                                <KoochBadge variant={transaction.direction === "Credit" ? "success" : "destructive"}>{transaction.direction === "Credit" ? "افزایش موجودی" : "کاهش موجودی"}</KoochBadge>
                                <time dateTime={transaction.createdAtUtc} className="text-muted-foreground">{formatDateTime(transaction.createdAtUtc)}</time>
                              </span>
                              <span className="font-semibold tabular-nums text-foreground" dir="ltr">{transaction.direction === "Credit" ? "+" : "−"}{formatCurrency(transaction.amount, { showCurrency: false })} {transaction.currency}</span>
                            </li>
                          ))}
                        </ul>}
                    </div>
                  </div>
                ))}
              </div>}
          </section>
        </div>}
      </KoochDialog>
    </div>
  );
}
