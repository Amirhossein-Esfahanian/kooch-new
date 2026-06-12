import Link from "next/link";

export function Footer() {
  return (
    <footer id="footer" className="bg-ink text-cream">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-2 md:items-end">
        <div>
          <Link href="/" className="text-2xl font-black tracking-tight">
            kooch<span className="text-coral">.</span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-6 text-cream/65">
            A simple place to discover characterful stays and plan a little time away.
          </p>
        </div>
        <div className="flex gap-6 text-sm font-semibold md:justify-end">
          <Link href="/">Home</Link>
          <Link href="/stays">Stays</Link>
        </div>
      </div>
      <div className="border-t border-cream/10 px-5 py-5 text-center text-xs text-cream/45">
        &copy; {new Date().getFullYear()} Kooch. Built for the journey ahead.
      </div>
    </footer>
  );
}

