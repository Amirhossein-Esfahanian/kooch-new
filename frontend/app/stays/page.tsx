import type { Metadata } from "next";
import { StayCard } from "@/components/StayCard";
import { stays } from "@/lib/stays";

export const metadata: Metadata = { title: "Explore stays" };

export default function StaysPage() {
  return (
    <div className="px-5 py-14 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-coral">The Kooch collection</p>
        <h1 className="mt-4 text-4xl font-black tracking-[-0.035em] sm:text-6xl">Find your kind of away.</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink/60 sm:text-lg">
          Thoughtful homes, quiet hideaways, and memorable bases for exploring somewhere new.
        </p>
        <div className="mt-12 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {stays.map((stay) => <StayCard key={stay.slug} stay={stay} />)}
        </div>
      </div>
    </div>
  );
}

