import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-cream/90 backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="text-2xl font-black tracking-tight text-ink" aria-label="Kooch home">
          kooch<span className="text-coral">.</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-6" aria-label="Main navigation">
          <Link href="/stays" className="rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-sand/70">
            Explore stays
          </Link>
          <a href="#footer" className="hidden text-sm font-semibold text-ink/65 transition hover:text-ink sm:block">
            About Kooch
          </a>
        </nav>
      </div>
    </header>
  );
}

