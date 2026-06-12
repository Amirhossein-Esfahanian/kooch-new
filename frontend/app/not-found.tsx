import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-5 py-28 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-coral">404</p>
      <h1 className="mt-4 text-4xl font-black tracking-tight">This stay has moved on.</h1>
      <p className="mt-4 text-ink/60">The place you are looking for is not in our collection.</p>
      <Link href="/stays" className="mt-8 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white">Explore stays</Link>
    </div>
  );
}

