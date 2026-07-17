"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AuthWorkspace,
  resolveSessionDestination,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";

type WorkspaceOption = {
  key: AuthWorkspace;
  title: string;
  description: string;
};

const options: WorkspaceOption[] = [
  { key: "admin", title: "پنل مدیریت سایت", description: "مدیریت اقامتگاه‌ها، کاربران، امکانات و گزارش‌ها" },
  { key: "owner", title: "پنل مالک اقامتگاه", description: "مدیریت اقامتگاه‌ها، اتاق‌ها، تصاویر و موجودی" },
  { key: "account", title: "سایت مسافر", description: "مشاهده صفحه اصلی، جست‌وجو و صفحات عمومی" },
];

export default function ChooseWorkspacePage() {
  const router = useRouter();
  const session = useAuthSession();
  const { authenticated, loading, user, workspaces } = session;
  const visibleOptions = options.filter(
    (option) => workspaces.includes(option.key),
  );

  function choose(option: WorkspaceOption) {
    router.push(
      option.key === "account"
        ? "/"
        : resolveSessionDestination(session, option.key),
    );
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl px-5 py-12 text-slate-500 sm:px-8">در حال آماده‌سازی...</div>;
  }

  if (!authenticated) {
    return (
      <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-5 py-12">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-black text-slate-950">ورود لازم است</h1>
          <p className="mt-2 text-sm text-slate-500">برای انتخاب محیط کاربری ابتدا وارد شوید.</p>
          <Link className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700" href="/login">
            ورود
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <div className="mb-8">
        <p className="text-sm font-bold text-blue-700">انتخاب موقت محیط کاربری</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">می‌خواهید وارد کدام محیط شوید؟</h1>
        <p className="mt-2 text-sm text-slate-500">
          {user?.fullName ? `${user.fullName} عزیز، ` : ""}این انتخاب برای طراحی رابط کاربری است و بعدا با نقش‌های واقعی جایگزین می‌شود.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {visibleOptions.map((option) => (
          <button
            className="rounded-2xl border border-slate-200 bg-white p-6 text-right shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md"
            key={option.key}
            onClick={() => choose(option)}
            type="button"
          >
            <span className="text-xl font-black text-slate-950">{option.title}</span>
            <span className="mt-3 block text-sm leading-6 text-slate-500">{option.description}</span>
            <span className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">ورود به محیط</span>
          </button>
        ))}
      </div>
    </div>
  );
}
