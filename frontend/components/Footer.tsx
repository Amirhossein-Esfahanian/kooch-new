import Link from "next/link";

export function Footer() {
  return (
    <footer id="footer" className="border-t border-slate-200 bg-white text-slate-700">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/" className="text-2xl font-black tracking-tight text-blue-700">کوچ</Link>
          <p className="mt-2 text-sm text-slate-500">اقامتگاه‌های سنتی و میزبانی محلی در کاشان</p>
        </div>
        <div className="flex flex-wrap gap-6 text-sm font-semibold">
          <a href="#footer">درباره ما</a>
          <a href="mailto:hello@kooch.local">تماس</a>
          <Link href="/owner/properties/new">میزبان شوید</Link>
        </div>
      </div>
      <div className="border-t border-slate-100 px-5 py-4 text-center text-xs text-slate-400">
        &copy; {new Date().getFullYear()} کوچ
      </div>
    </footer>
  );
}
