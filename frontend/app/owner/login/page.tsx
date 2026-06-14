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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        throw new Error("This account cannot use owner property tools.");
      }
      setToken(response.token);
      router.push("/owner/properties");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="mb-2 text-3xl font-black">Owner login</h1>
      <p className="mb-6 text-ink/65">The JWT is stored in localStorage for this temporary test UI.</p>
      <form className="grid gap-4 rounded-xl border border-ink/10 bg-white p-6 shadow-sm" onSubmit={submit}>
        <label className="grid gap-1 text-sm font-semibold">Email<input className="rounded-lg border border-ink/20 px-3 py-2" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label className="grid gap-1 text-sm font-semibold">Password<input className="rounded-lg border border-ink/20 px-3 py-2" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="rounded-lg bg-ink px-4 py-3 font-bold text-white disabled:opacity-50" disabled={loading} type="submit">{loading ? "Logging in..." : "Log in"}</button>
      </form>
    </div>
  );
}
