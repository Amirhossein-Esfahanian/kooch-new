"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochField, KoochInput, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { apiRequest } from "@/lib/owner-api";

type TaskStatus = "Open" | "InProgress" | "Done" | "Cancelled";
type TaskPriority = "Low" | "Normal" | "High";
type TaskChange = {
  id: number;
  actorDisplayName: string;
  changeType: "Created" | "Reassigned" | "StatusChanged";
  occurredAtUtc: string;
  previousStatus: TaskStatus | null;
  newStatus: TaskStatus | null;
  previousAssigneeUserId: number | null;
  newAssigneeUserId: number | null;
  resolutionNote: string | null;
};
type AdminTask = {
  id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAtUtc: string | null;
  createdByUserId: number;
  assignedToUserId: number;
  reservationId: number | null;
  status: TaskStatus;
  resolutionNote: string | null;
  createdAtUtc: string;
  updatedAtUtc: string | null;
  completedAtUtc: string | null;
  changes: TaskChange[];
};
type TaskAssignee = { id: number; displayName: string };
type ReservationOption = { reservationId: number; reservationNumber: string; propertyName: string };
type ReservationDetailOption = { id?: number; reservationId?: number; reservationNumber: string; propertyName?: string | null };
type ReservationSearchResult = { items: ReservationOption[] };
type CreateDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  dueAtLocal: string;
  assignedToUserId: string;
  reservationId: string;
};
const emptyCreateDraft = (): CreateDraft => ({
  title: "", description: "", priority: "Normal", dueAtLocal: "", assignedToUserId: "", reservationId: "",
});

const statuses: { value: TaskStatus; label: string }[] = [
  { value: "Open", label: "باز" },
  { value: "InProgress", label: "در حال انجام" },
  { value: "Done", label: "انجام‌شده" },
  { value: "Cancelled", label: "لغوشده" },
];
const statusLabel = (value: TaskStatus) => statuses.find((item) => item.value === value)?.label ?? value;
const priorityLabel: Record<TaskPriority, string> = { Low: "کم", Normal: "عادی", High: "زیاد" };
const statusVariant = (status: TaskStatus) => status === "Done" ? "success" : status === "Cancelled" ? "muted" : status === "InProgress" ? "default" : "warning";
const errorText = (error: unknown) => error instanceof Error ? error.message : "درخواست انجام نشد. دوباره تلاش کنید.";

export default function AdminTasksPage() {
  const { user, authenticated, loading: sessionLoading, workspaces, platformRole, platformPermissions } = useAuthSession();
  const currentUserId = user?.userId;
  const canReadTasks = !sessionLoading && authenticated && workspaces.includes("admin")
    && (platformRole === "SuperAdmin" || platformPermissions.includes("ManageReservations"));
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<"assigned" | "created">("assigned");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [selected, setSelected] = useState<AdminTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<TaskStatus>("Open");
  const [resolutionNote, setResolutionNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationOptions, setReservationOptions] = useState<ReservationOption[]>([]);
  const [reservationSearching, setReservationSearching] = useState(false);
  const [reservationSearched, setReservationSearched] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const handledReservationLink = useRef(false);
  const [nextAssigneeId, setNextAssigneeId] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTasks(await apiRequest<AdminTask[]>("/admin/tasks"));
    } catch (error) {
      setLoadError(errorText(error));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (canReadTasks) void load(); }, [canReadTasks, load]);

  const loadAssignees = useCallback(async () => {
    setAssigneesLoading(true);
    setAssigneesError(null);
    try {
      setAssignees(await apiRequest<TaskAssignee[]>("/admin/tasks/assignees"));
    } catch (error) {
      setAssigneesError(errorText(error));
      setAssignees([]);
    } finally {
      setAssigneesLoading(false);
    }
  }, []);
  useEffect(() => { if (canReadTasks) void loadAssignees(); }, [canReadTasks, loadAssignees]);

  const visible = useMemo(() => tasks.filter((task) =>
    (scope === "assigned" ? task.assignedToUserId === currentUserId : task.createdByUserId === currentUserId)
    && (statusFilter === "all" || task.status === statusFilter),
  ), [tasks, scope, statusFilter, currentUserId]);

  const assigneeName = (id: number) => assignees.find((assignee) => assignee.id === id)?.displayName
    ?? (id === currentUserId && user?.fullName ? user.fullName : `کاربر مدیریتی ${formatNumber(id)}`);

  const openTask = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setSelected(null);
    try {
      const task = await apiRequest<AdminTask>(`/admin/tasks/${id}`);
      setSelected(task);
      setNextStatus(task.status);
      setNextAssigneeId(String(task.assignedToUserId));
      setReassignError(null);
      setResolutionNote("");
    } catch (error) {
      setDetailError(errorText(error));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openCreate() {
    setCreateDraft(emptyCreateDraft());
    setCreateError(null);
    setReservationSearch("");
    setReservationOptions([]);
    setReservationError(null);
    setReservationSearched(false);
    setCreateOpen(true);
  }

  useEffect(() => {
    if (!canReadTasks || handledReservationLink.current) return;
    const rawId = new URLSearchParams(window.location.search).get("reservationId");
    if (rawId === null) return;
    handledReservationLink.current = true;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) return;
    openCreate();
    setReservationSearching(true);
    void apiRequest<ReservationDetailOption>(`/admin/reservations/${rawId}`)
      .then((reservation) => {
        if ((reservation.reservationId ?? reservation.id) !== Number(rawId)) throw new Error("رزرو انتخاب‌شده معتبر نیست.");
        setReservationOptions([{ reservationId: Number(rawId), reservationNumber: reservation.reservationNumber, propertyName: reservation.propertyName ?? "" }]);
        setCreateDraft((current) => ({ ...current, reservationId: rawId }));
      })
      .catch((error) => {
        setReservationError(errorText(error));
      })
      .finally(() => {
        setReservationSearching(false);
      });
  }, [canReadTasks]);

  async function searchReservations() {
    const query = reservationSearch.trim();
    if (!query) return;
    setReservationSearching(true);
    setReservationSearched(true);
    setReservationError(null);
    try {
      const params = new URLSearchParams({ reservationNumber: query, page: "1", pageSize: "10" });
      const result = await apiRequest<ReservationSearchResult>(`/admin/reservations?${params.toString()}`);
      setReservationOptions(result.items);
    } catch (error) {
      setReservationOptions([]);
      setReservationError(errorText(error));
    } finally {
      setReservationSearching(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    if (!createDraft.title.trim() || !createDraft.assignedToUserId) {
      setCreateError("عنوان و مسئول کار را تعیین کنید.");
      return;
    }
    const dueAt = createDraft.dueAtLocal ? new Date(createDraft.dueAtLocal) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      setCreateError("زمان سررسید معتبر نیست.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await apiRequest<AdminTask>("/admin/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: createDraft.title.trim(),
          description: createDraft.description.trim() || null,
          priority: createDraft.priority,
          dueAtUtc: dueAt?.toISOString() ?? null,
          assignedToUserId: Number(createDraft.assignedToUserId),
          reservationId: createDraft.reservationId ? Number(createDraft.reservationId) : null,
        }),
      });
      setCreateOpen(false);
      setScope("created");
      setStatusFilter("all");
      await load();
      toast.success("کار ایجاد شد.");
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      setCreating(false);
    }
  }

  async function reassignTask() {
    if (!selected || reassigning || !nextAssigneeId || Number(nextAssigneeId) === selected.assignedToUserId) return;
    setReassigning(true);
    setReassignError(null);
    try {
      const updated = await apiRequest<AdminTask>(`/admin/tasks/${selected.id}/assignee`, {
        method: "PUT", body: JSON.stringify({ assignedToUserId: Number(nextAssigneeId) }),
      });
      setSelected(updated);
      await load();
      toast.success("مسئول کار تغییر کرد.");
    } catch (error) {
      setReassignError(errorText(error));
    } finally {
      setReassigning(false);
    }
  }

  async function saveStatus() {
    if (!selected || saving || nextStatus === selected.status) return;
    setSaving(true);
    setDetailError(null);
    try {
      const updated = await apiRequest<AdminTask>(`/admin/tasks/${selected.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus, resolutionNote: resolutionNote.trim() || null }),
      });
      setSelected(updated);
      setTasks((previous) => previous.map((task) => task.id === updated.id ? updated : task));
      setResolutionNote("");
      toast.success("وضعیت کار به‌روزرسانی شد.");
    } catch (error) {
      setDetailError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout requiredPlatformPermission="ManageReservations">
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
        <KoochPageHeader appearance="plain" eyebrow="پنل مدیریت" title="کارهای من" description="کارهای واگذارشده به شما و کارهایی که ایجاد کرده‌اید." actions={<KoochButton onClick={openCreate}>ایجاد کار</KoochButton>} />
        <KoochCard className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2" role="group" aria-label="نمای کارها">
              <KoochButton size="sm" variant={scope === "assigned" ? "primary" : "outline"} aria-pressed={scope === "assigned"} onClick={() => setScope("assigned")}>واگذارشده به من</KoochButton>
              <KoochButton size="sm" variant={scope === "created" ? "primary" : "outline"} aria-pressed={scope === "created"} onClick={() => setScope("created")}>ایجادشده توسط من</KoochButton>
            </div>
            <KoochField label="وضعیت" className="w-full sm:ms-auto sm:w-48">
              <KoochSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "all")}>
                <option value="all">همه وضعیت‌ها</option>
                {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </KoochSelect>
            </KoochField>
          </div>
          {loading ? <p role="status" className="text-sm text-muted-foreground">در حال بارگذاری کارها…</p> : loadError ? (
            <div className="grid justify-items-start gap-3"><KoochAlert variant="destructive">{loadError}</KoochAlert><KoochButton variant="outline" onClick={() => void load()}>تلاش دوباره</KoochButton></div>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">کاری با این وضعیت در این بخش وجود ندارد.</p>
          ) : <div className="grid gap-3">
            {visible.map((task) => <article key={task.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto] lg:items-center">
              <div className="min-w-0"><h2 className="font-semibold text-foreground">{task.title}</h2><div className="mt-1 flex flex-wrap gap-2"><KoochBadge variant={statusVariant(task.status)}>{statusLabel(task.status)}</KoochBadge><KoochBadge variant={task.priority === "High" ? "warning" : "muted"}>اولویت {priorityLabel[task.priority]}</KoochBadge></div></div>
              <p className="text-sm"><span className="text-muted-foreground">مسئول: </span>{assigneeName(task.assignedToUserId)}</p>
              <p className="text-sm"><span className="text-muted-foreground">سررسید: </span>{task.dueAtUtc ? formatDateTime(task.dueAtUtc) : "بدون سررسید"}</p>
              <div className="text-sm">{task.reservationId ? <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/reservations?reservationId=${task.reservationId}`}>رزرو {formatNumber(task.reservationId)}</Link> : <span className="text-muted-foreground">بدون رزرو مرتبط</span>}</div>
              <KoochButton size="sm" variant="outline" onClick={() => void openTask(task.id)} aria-label={`جزئیات ${task.title}`}>جزئیات</KoochButton>
            </article>)}
          </div>}
        </KoochCard>
        <KoochDialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }} title="ایجاد کار" size="md" closeDisabled={creating}>
          <form className="grid gap-4" onSubmit={(event) => void createTask(event)}>
            <KoochField label="عنوان" required>
              <KoochInput value={createDraft.title} maxLength={250} required disabled={creating} onChange={(event) => setCreateDraft({ ...createDraft, title: event.target.value })} />
            </KoochField>
            <KoochField label="شرح">
              <KoochTextarea value={createDraft.description} maxLength={4000} disabled={creating} onChange={(event) => setCreateDraft({ ...createDraft, description: event.target.value })} />
            </KoochField>
            <div className="grid gap-4 sm:grid-cols-2">
              <KoochField label="اولویت" required>
                <KoochSelect value={createDraft.priority} disabled={creating} onChange={(event) => setCreateDraft({ ...createDraft, priority: event.target.value as TaskPriority })}>
                  <option value="Low">کم</option><option value="Normal">عادی</option><option value="High">زیاد</option>
                </KoochSelect>
              </KoochField>
              <KoochField label="سررسید (اختیاری)" helperText="زمان را به وقت محلی خود وارد کنید.">
                <KoochInput type="datetime-local" value={createDraft.dueAtLocal} disabled={creating} onChange={(event) => setCreateDraft({ ...createDraft, dueAtLocal: event.target.value })} />
              </KoochField>
            </div>
            <KoochField label="مسئول کار" required>
              <KoochSelect value={createDraft.assignedToUserId} disabled={creating || assigneesLoading || Boolean(assigneesError)} onChange={(event) => setCreateDraft({ ...createDraft, assignedToUserId: event.target.value })}>
                <option value="">انتخاب مدیر</option>
                {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>)}
              </KoochSelect>
            </KoochField>
            {assigneesLoading && <p role="status" className="text-sm text-muted-foreground">در حال دریافت مدیران…</p>}
            {assigneesError && <div className="grid justify-items-start gap-2"><KoochAlert variant="destructive">{assigneesError}</KoochAlert><KoochButton variant="outline" onClick={() => void loadAssignees()}>تلاش دوباره</KoochButton></div>}
            <div className="grid gap-2">
              <KoochField label="جستجوی رزرو (اختیاری)">
                <KoochInput value={reservationSearch} placeholder="شماره رزرو، مانند R-123456" disabled={creating || reservationSearching} onChange={(event) => { setReservationSearch(event.target.value); setReservationOptions([]); setReservationSearched(false); setCreateDraft((current) => ({ ...current, reservationId: "" })); }} />
              </KoochField>
              <KoochButton className="justify-self-start" size="sm" variant="outline" disabled={!reservationSearch.trim()} loading={reservationSearching} onClick={() => void searchReservations()}>جستجوی رزرو</KoochButton>
              {reservationError && <KoochAlert variant="destructive">{reservationError}</KoochAlert>}
              {reservationOptions.length > 0 && <KoochField label="رزرو مرتبط">
                <KoochSelect value={createDraft.reservationId} disabled={creating} onChange={(event) => setCreateDraft({ ...createDraft, reservationId: event.target.value })}>
                  <option value="">بدون رزرو مرتبط</option>
                  {reservationOptions.map((reservation) => <option key={reservation.reservationId} value={reservation.reservationId}>{reservation.reservationNumber} — {reservation.propertyName}</option>)}
                </KoochSelect>
              </KoochField>}
              {reservationSearched && !reservationSearching && reservationOptions.length === 0 && !reservationError && <p className="text-xs text-muted-foreground">رزروی با این شماره پیدا نشد.</p>}
            </div>
            {createError && <KoochAlert variant="destructive">{createError}</KoochAlert>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <KoochButton variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>انصراف</KoochButton>
              <KoochButton type="submit" loading={creating} disabled={assigneesLoading || Boolean(assigneesError) || !createDraft.title.trim() || !createDraft.assignedToUserId}>ایجاد کار</KoochButton>
            </div>
          </form>
        </KoochDialog>
        <KoochDialog open={selected !== null || detailLoading || detailError !== null} onOpenChange={(open) => { if (!open && !saving && !reassigning) { setSelected(null); setDetailError(null); } }} title={selected?.title ?? "جزئیات کار"} size="md" closeDisabled={saving || reassigning}>
          {detailLoading ? <p role="status">در حال دریافت جزئیات…</p> : detailError && !selected ? <div className="grid justify-items-start gap-3"><KoochAlert variant="destructive">{detailError}</KoochAlert><KoochButton variant="outline" onClick={() => setDetailError(null)}>بستن</KoochButton></div> : selected && <div className="grid gap-5">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>وضعیت: <KoochBadge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</KoochBadge></p>
              <p>اولویت: {priorityLabel[selected.priority]}</p>
              <p>مسئول: {assigneeName(selected.assignedToUserId)}</p>
              <p>سررسید: {selected.dueAtUtc ? formatDateTime(selected.dueAtUtc) : "بدون سررسید"}</p>
              {selected.reservationId && <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/reservations?reservationId=${selected.reservationId}`}>مشاهده رزرو مرتبط</Link>}
            </div>
            {selected.description && <p className="whitespace-pre-wrap text-sm text-foreground">{selected.description}</p>}
            {selected.resolutionNote && <p className="text-sm"><span className="text-muted-foreground">یادداشت نتیجه: </span>{selected.resolutionNote}</p>}
            <section className="grid gap-3 border-t border-border pt-4" aria-label="تغییر مسئول">
              <KoochField label="مسئول جدید">
                <KoochSelect value={nextAssigneeId} disabled={saving || reassigning || assigneesLoading || Boolean(assigneesError)} onChange={(event) => setNextAssigneeId(event.target.value)}>
                  {!assignees.some((assignee) => assignee.id === selected.assignedToUserId) && <option value={selected.assignedToUserId}>{assigneeName(selected.assignedToUserId)}</option>}
                  {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.displayName}</option>)}
                </KoochSelect>
              </KoochField>
              {assigneesError && <div className="grid justify-items-start gap-2"><KoochAlert variant="destructive">{assigneesError}</KoochAlert><KoochButton variant="outline" onClick={() => void loadAssignees()}>تلاش دوباره</KoochButton></div>}
              {reassignError && <KoochAlert variant="destructive">{reassignError}</KoochAlert>}
              <KoochButton className="justify-self-start" variant="outline" loading={reassigning} disabled={saving || assigneesLoading || Boolean(assigneesError) || !nextAssigneeId || Number(nextAssigneeId) === selected.assignedToUserId} onClick={() => void reassignTask()}>تغییر مسئول</KoochButton>
            </section>
            <section className="grid gap-3 border-t border-border pt-4" aria-label="تغییر وضعیت">
              <KoochField label="وضعیت جدید"><KoochSelect value={nextStatus} onChange={(event) => setNextStatus(event.target.value as TaskStatus)} disabled={saving || reassigning}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</KoochSelect></KoochField>
              <KoochField label="یادداشت نتیجه (اختیاری)"><KoochTextarea maxLength={4000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} disabled={saving || reassigning} /></KoochField>
              {detailError && <KoochAlert variant="destructive">{detailError}</KoochAlert>}
              <KoochButton className="justify-self-start" loading={saving} disabled={reassigning || nextStatus === selected.status} onClick={() => void saveStatus()}>ثبت وضعیت</KoochButton>
            </section>
            <section className="grid gap-3 border-t border-border pt-4" aria-label="تاریخچه تغییرات">
              <h3 className="font-semibold">تاریخچه تغییرات</h3>
              {selected.changes.length === 0 ? <p className="text-sm text-muted-foreground">تغییری ثبت نشده است.</p> : <ol className="grid gap-3">{selected.changes.map((change) => <li key={change.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{change.changeType === "Created" ? "ایجاد کار" : change.changeType === "Reassigned" ? "تغییر مسئول" : "تغییر وضعیت"}</span><time className="text-muted-foreground" dateTime={change.occurredAtUtc}>{formatDateTime(change.occurredAtUtc)}</time></div><p className="mt-1 text-muted-foreground">{change.actorDisplayName || "سیستم"}{change.changeType === "StatusChanged" && change.newStatus ? ` · ${statusLabel(change.previousStatus ?? "Open")} ← ${statusLabel(change.newStatus)}` : ""}{change.changeType === "Reassigned" && change.newAssigneeUserId ? ` · ${assigneeName(change.newAssigneeUserId)}` : ""}</p>{change.resolutionNote && <p className="mt-2 whitespace-pre-wrap">{change.resolutionNote}</p>}</li>)}</ol>}
            </section>
          </div>}
        </KoochDialog>
      </main>
    </AdminLayout>
  );
}
