import Link from "next/link";
import { HeroSection } from "@/components/HeroSection";
import { StayCard } from "@/components/StayCard";
import { stays } from "@/lib/stays";

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <section id="featured" className="bg-white/45 px-5 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-coral">Handpicked places</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Stays we love right now</h2>
            </div>
            <Link href="/stays" className="text-sm font-bold text-moss underline decoration-moss/30 underline-offset-8 hover:decoration-moss">
              View every stay
            </Link>
          </div>
          <div className="mt-10 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {stays.slice(0, 3).map((stay) => <StayCard key={stay.slug} stay={stay} />)}
          </div>
        </div>
      </section>
      <section className="px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[2.5rem] bg-moss px-7 py-12 text-cream sm:px-12 lg:grid-cols-[1fr_auto] lg:items-center lg:px-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cream/55">Travel with intention</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">Less searching. More looking forward to it.</h2>
          </div>
          <Link href="/stays" className="w-fit rounded-full bg-cream px-6 py-3 text-sm font-bold text-ink transition hover:bg-white">
            Find your stay
          </Link>
        </div>
      </section>
    </>
  );
}

