import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStay, stays } from "@/lib/stays";

type StayDetailsPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return stays.map((stay) => ({ slug: stay.slug }));
}

export async function generateMetadata({ params }: StayDetailsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const stay = getStay(slug);
  return stay ? { title: stay.name, description: stay.description } : {};
}

export default async function StayDetailsPage({ params }: StayDetailsPageProps) {
  const { slug } = await params;
  const stay = getStay(slug);

  if (!stay) notFound();

  return (
    <div className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-7xl">
        <Link href="/stays" className="text-sm font-bold text-moss hover:underline">&larr; Back to all stays</Link>
        <div className="mt-7 overflow-hidden rounded-[2rem] bg-sand">
          <div className="relative aspect-[16/9] max-h-[620px]">
            <Image src={stay.image} alt={stay.name} fill priority className="object-cover" sizes="100vw" />
          </div>
        </div>
        <div className="grid gap-10 py-10 lg:grid-cols-[1fr_360px] lg:gap-16 lg:py-14">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-coral">{stay.location}</p>
            <h1 className="mt-3 text-4xl font-black tracking-[-0.035em] sm:text-5xl">{stay.name}</h1>
            <p className="mt-5 border-b border-ink/10 pb-7 text-sm font-semibold text-ink/65">
              {stay.guests} guests &middot; {stay.bedrooms} {stay.bedrooms === 1 ? "bedroom" : "bedrooms"} &middot; &#9733; {stay.rating}
            </p>
            <p className="mt-7 max-w-3xl text-base leading-8 text-ink/70">{stay.longDescription}</p>
            <h2 className="mt-10 text-xl font-black">What this place offers</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {stay.amenities.map((amenity) => (
                <li key={amenity} className="rounded-2xl border border-ink/10 bg-white/50 px-4 py-3 text-sm font-semibold">{amenity}</li>
              ))}
            </ul>
          </div>
          <aside className="h-fit rounded-3xl bg-white p-6 shadow-soft lg:sticky lg:top-28">
            <p><span className="text-2xl font-black">${stay.pricePerNight}</span> <span className="text-sm text-ink/55">/ night</span></p>
            <div className="mt-6 rounded-2xl bg-cream p-4 text-sm leading-6 text-ink/65">
              Booking will be available in a future release. For now, enjoy exploring the collection.
            </div>
            <Link href="/stays" className="mt-5 block rounded-full bg-ink px-6 py-3.5 text-center text-sm font-bold text-white transition hover:bg-moss">
              Explore similar stays
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}

