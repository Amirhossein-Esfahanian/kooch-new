"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, setToken } from "@/lib/owner-api";

interface AuthResponse {
  token: string;
  fullName: string;
  role: string;
}

export default function OwnerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@kooch.local");
  const [password, setPassword] = useState("Admin@12345");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!["Owner", "OwnerAssistant", "SuperAdmin", "AdminAssistant"].includes(response.role)) {
        throw new Error("این حساب اجازه ورود به پنل میزبانی را ندارد.");
      }
      setToken(response.token);
      router.push("/owner/properties");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ورود ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[70vh] max-w-md place-items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-950">ورود میزبان</h1>
        <p className="mt-2 text-sm text-slate-500">برای مدیریت اقامتگاه‌ها وارد حساب کاربری شوید.</p>
        <form className="mt-6 grid gap-4" onSubmit={submit}>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            ایمیل
            <input className="rounded-xl border border-slate-300 px-3 py-2.5 text-left" dir="ltr" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            رمز عبور
            <input className="rounded-xl border border-slate-300 px-3 py-2.5 text-left" dir="ltr" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50" disabled={loading} type="submit">
            {loading ? "در حال ورود..." : "ورود"}
          </button>
        </form>
      </section>
    </div>
  );
}
