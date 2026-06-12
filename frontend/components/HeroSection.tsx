import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20">
      <div className="absolute -right-28 top-8 h-80 w-80 rounded-full bg-coral/15 blur-3xl" />
      <div className="absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-moss/15 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.28em] text-coral">Go somewhere that stays with you</p>
          <h1 className="max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Find a place worth <span className="text-moss">slowing down</span> for.
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-ink/65 sm:text-lg">
            From quiet cabins to sunlit city homes, Kooch brings together stays with a sense of place.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <Link href="/stays" className="rounded-full bg-ink px-7 py-3.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-moss">
              Explore all stays
            </Link>
            <a href="#featured" className="rounded-full border border-ink/20 px-7 py-3.5 text-sm font-bold transition hover:border-ink hover:bg-white/40">
              See our picks
            </a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xl">
          <div className="aspect-[4/5] overflow-hidden rounded-[2.5rem] bg-[url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85')] bg-cover bg-center shadow-soft" />
          <div className="absolute -bottom-5 -left-3 rounded-2xl bg-white p-4 shadow-soft sm:-left-8 sm:p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-coral">Featured</p>
            <p className="mt-1 font-bold">The Cedar House</p>
            <p className="mt-1 text-xs text-ink/55">Mazandaran, Iran</p>
          </div>
        </div>
      </div>
    </section>
  );
}

