import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="text-2xl font-black tracking-tight text-blue-700" aria-label="Kooch home">
          کوچ
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Main navigation">
          <Link href="/properties" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
            اقامتگاه‌ها
          </Link>
          <Link href="/owner/properties/new" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:block">
            میزبان شوید
          </Link>
          <Link href="/owner/login" className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50">ورود</Link>
        </nav>
      </div>
    </header>
  );
}
