"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochIcon } from "@/components/KoochIcon";
import { KoochField, KoochInput, KoochSelect, KoochTextarea } from "@/components/KoochFormControls";
import { apiRequest } from "@/lib/owner-api";

type TaskPriority = "Low" | "Normal" | "High";
export type TaskAssignee = { id: number; displayName: string };
type AssigneeResource = { items: TaskAssignee[]; loading: boolean; error: string | null; retry: () => void };
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


const errorText = (error: unknown) => error instanceof Error ? error.message : "درخواست انجام نشد. دوباره تلاش کنید.";

export function AdminTaskCreateDialog({ onClose, onCreated, initialReservationId, assigneeResource }: {
  onClose: () => void; onCreated: () => void | Promise<void>;
  initialReservationId?: number; assigneeResource?: AssigneeResource;
}) {
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const submissionInFlight = useRef(false);
  const dueHintId = useId();
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationOptions, setReservationOptions] = useState<ReservationOption[]>([]);
  const [reservationSearching, setReservationSearching] = useState(Boolean(initialReservationId));
  const [reservationSearched, setReservationSearched] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [loadedAssignees, setLoadedAssignees] = useState<TaskAssignee[]>([]);
  const [loadingAssignees, setLoadingAssignees] = useState(!assigneeResource);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [assigneeAttempt, setAssigneeAttempt] = useState(0);
  const hasAssigneeResource = Boolean(assigneeResource);

  useEffect(() => {
    if (hasAssigneeResource) return;
    let active = true;
    setLoadingAssignees(true);
    setAssigneeError(null);
    void apiRequest<TaskAssignee[]>("/admin/tasks/assignees")
      .then(items => { if (active) setLoadedAssignees(items); })
      .catch(error => { if (active) setAssigneeError(errorText(error)); })
      .finally(() => { if (active) setLoadingAssignees(false); });
    return () => { active = false; };
  }, [hasAssigneeResource, assigneeAttempt]);
  const assignees = assigneeResource?.items ?? loadedAssignees;
  const assigneesLoading = assigneeResource?.loading ?? loadingAssignees;
  const assigneesError = assigneeResource?.error ?? assigneeError;
  const loadAssignees = () => assigneeResource ? assigneeResource.retry() : setAssigneeAttempt(value => value + 1);

  useEffect(() => {
    if (!initialReservationId) return;
    let active = true;
    void apiRequest<ReservationDetailOption>(`/admin/reservations/${initialReservationId}`)
      .then(reservation => {
        if (!active) return;
        if ((reservation.reservationId ?? reservation.id) !== initialReservationId) throw new Error("رزرو انتخاب‌شده معتبر نیست.");
        setReservationOptions([{ reservationId: initialReservationId, reservationNumber: reservation.reservationNumber, propertyName: reservation.propertyName ?? "" }]);
        setCreateDraft(current => ({ ...current, reservationId: String(initialReservationId) }));
      })
      .catch(error => { if (active) setReservationError(errorText(error)); })
      .finally(() => { if (active) setReservationSearching(false); });
    return () => { active = false; };
  }, [initialReservationId]);

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
    if (submissionInFlight.current || reservationSearching || (initialReservationId && reservationError)) return;
    if (!createDraft.title.trim() || !createDraft.assignedToUserId) {
      setCreateError("عنوان و مسئول کار را تعیین کنید.");
      return;
    }
    const dueAt = createDraft.dueAtLocal ? new Date(createDraft.dueAtLocal) : null;
    if (dueAt && (!createDraft.dueAtLocal.split("T")[1] || Number.isNaN(dueAt.getTime()))) {
      setCreateError("زمان سررسید معتبر نیست.");
      return;
    }
    submissionInFlight.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      await apiRequest<unknown>("/admin/tasks", {
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
      onClose();
      await onCreated();
      toast.success("کار ایجاد شد.");
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      submissionInFlight.current = false;
      setCreating(false);
    }
  }


  return <KoochDialog open onOpenChange={open => { if (!open && !creating) onClose(); }} title="ایجاد کار" size="md" closeDisabled={creating}>
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
              <fieldset className="grid min-w-0 gap-2" disabled={creating} aria-describedby={dueHintId}>
                <legend className="mb-2 text-sm font-semibold">سررسید (اختیاری)</legend>
                <KoochDatePicker mode="single" label={null} placeholder="انتخاب تاریخ سررسید" size="compact" portal
                  value={createDraft.dueAtLocal.split("T")[0] || null}
                  onChange={date => { if (!creating) setCreateDraft(current => ({ ...current,
                    dueAtLocal: date ? `${date}T${current.dueAtLocal.split("T")[1] || "00:00"}` : "",
                  })); }} />
                <KoochField label="ساعت سررسید">
                  <KoochInput type="time" value={createDraft.dueAtLocal.split("T")[1] || ""}
                    disabled={creating || !createDraft.dueAtLocal} required={Boolean(createDraft.dueAtLocal)}
                    onChange={event => setCreateDraft(current => ({ ...current,
                      dueAtLocal: `${current.dueAtLocal.split("T")[0]}T${event.target.value}`,
                    }))} />
                </KoochField>
                <p id={dueHintId} className="text-xs text-muted-foreground">زمان را به وقت محلی خود وارد کنید.</p>
                {createDraft.dueAtLocal && <KoochButton type="button" size="sm" variant="ghost" className="justify-self-start"
                  onClick={() => setCreateDraft(current => ({ ...current, dueAtLocal: "" }))}>پاک کردن سررسید</KoochButton>}
              </fieldset>
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
              <KoochButton type="button" className="justify-self-start" size="sm" variant="utility" leftIcon={<KoochIcon name="search" style={{ width: 16, height: 16 }} />} disabled={!reservationSearch.trim()} loading={reservationSearching} onClick={() => void searchReservations()}>جستجوی رزرو</KoochButton>
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
              <KoochButton type="button" variant="outline" disabled={creating} onClick={onClose}>انصراف</KoochButton>
              <KoochButton type="submit" loading={creating} disabled={reservationSearching || Boolean(initialReservationId && reservationError) || assigneesLoading || Boolean(assigneesError) || !createDraft.title.trim() || !createDraft.assignedToUserId}>ایجاد کار</KoochButton>
            </div>
          </form>
  </KoochDialog>;
}
