"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";
import { clearToken } from "@/lib/owner-api";

export function OwnerPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();

  function logout() {
    clearToken();
    router.push("/owner/login");
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-ink/50">Owner test area</p>
          <h1 className="text-3xl font-black text-ink">{title}</h1>
        </div>
        <div className="flex gap-3">
          <Link className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold" href="/owner/properties">
            Properties
          </Link>
          <Link className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold" href="/owner/amenities">
            Amenities
          </Link>
          <Link className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold" href="/admin/properties">
            Admin
          </Link>
          <button className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold" onClick={logout} type="button">
            Log out
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
