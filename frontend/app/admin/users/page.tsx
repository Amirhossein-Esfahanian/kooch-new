"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminUserResponse, apiRequest, getToken, UserRole } from "@/lib/owner-api";

const roles: UserRole[] = ["SuperAdmin", "AdminAssistant", "Owner", "OwnerAssistant", "Client"];
const roleLabels: Record<UserRole, string> = {
  SuperAdmin: "مدیر ارشد",
  AdminAssistant: "دستیار مدیر",
  Owner: "مالک اقامتگاه",
  OwnerAssistant: "همکار مالک",
  Client: "مسافر",
};

type UserForm = {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
  parentUserId: string;
  propertyId: string;
};

const emptyForm: UserForm = {
  id: null,
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
  role: "Client",
  parentUserId: "",
  propertyId: "",
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setUsers(await apiRequest<AdminUserResponse[]>("/admin/users"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load().catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  }, [router]);

  function edit(user: AdminUserResponse) {
    setForm({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber ?? "",
      password: "",
      role: user.role,
      parentUserId: user.parentUserId?.toString() ?? "",
      propertyId: "",
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phoneNumber: form.phoneNumber || null,
        password: form.password || null,
        role: form.role,
        parentUserId: form.parentUserId ? Number(form.parentUserId) : null,
        propertyId: form.propertyId ? Number(form.propertyId) : null,
      };
      await apiRequest<AdminUserResponse>(form.id ? `/admin/users/${form.id}` : "/admin/users", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      setForm(emptyForm);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره کاربر انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(user: AdminUserResponse, active: boolean) {
    setError("");
    try {
      const updated = await apiRequest<AdminUserResponse>(`/admin/users/${user.id}/${active ? "activate" : "deactivate"}`, { method: "PUT" });
      setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تغییر وضعیت کاربر انجام نشد.");
    }
  }

  return (
    <AdminPage title="مدیریت کاربران">
      {error && <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
      <form className="mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={submit}>
        <h2 className="text-xl font-black text-slate-950">{form.id ? "ویرایش کاربر" : "ایجاد کاربر"}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <input className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setForm({ ...form, firstName: event.target.value })} placeholder="نام" required value={form.firstName} />
          <input className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setForm({ ...form, lastName: event.target.value })} placeholder="نام خانوادگی" required value={form.lastName} />
          <input className="rounded-xl border border-slate-300 px-3 py-2.5 text-left" dir="ltr" onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="ایمیل" required type="email" value={form.email} />
          <input className="rounded-xl border border-slate-300 px-3 py-2.5 text-left" dir="ltr" onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} placeholder="شماره تماس" value={form.phoneNumber} />
          <input className="rounded-xl border border-slate-300 px-3 py-2.5 text-left" dir="ltr" minLength={8} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={form.id ? "رمز جدید اختیاری" : "رمز عبور"} required={!form.id} type="password" value={form.password} />
          <select className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} value={form.role}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>
          <select className="rounded-xl border border-slate-300 px-3 py-2.5" onChange={(event) => setForm({ ...form, parentUserId: event.target.value })} value={form.parentUserId}>
            <option value="">والد کاربر</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.email}</option>)}
          </select>
          <input className="rounded-xl border border-slate-300 px-3 py-2.5" min="1" onChange={(event) => setForm({ ...form, propertyId: event.target.value })} placeholder="شناسه اقامتگاه برای همکار مالک" type="number" value={form.propertyId} />
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-xl bg-blue-600 px-5 py-3 font-black text-white hover:bg-blue-700 disabled:opacity-50" disabled={saving} type="submit">{saving ? "در حال ذخیره..." : "ذخیره کاربر"}</button>
          {form.id && <button className="rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700" onClick={() => setForm(emptyForm)} type="button">لغو ویرایش</button>}
        </div>
      </form>

      {loading && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری کاربران...</p>}
      <div className="grid gap-3">
        {users.map((user) => (
          <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={user.id}>
            <div>
              <p className="font-black text-slate-950">#{user.id} · {user.fullName || user.email}</p>
              <p className="mt-1 text-sm text-slate-500">{user.email} · {roleLabels[user.role]} · والد: {user.parentUserName ?? "-"}</p>
              <p className="mt-1 text-xs text-slate-400">{user.isActive ? "فعال" : "غیرفعال"} · {new Date(user.createdAtUtc).toLocaleDateString("fa-IR")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-bold text-blue-700" onClick={() => edit(user)} type="button">ویرایش</button>
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500" disabled type="button">بازنشانی رمز عبور</button>
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700" onClick={() => setActive(user, !user.isActive)} type="button">{user.isActive ? "غیرفعال" : "فعال"}</button>
            </div>
          </article>
        ))}
      </div>
    </AdminPage>
  );
}
