import Image from "next/image";
import Link from "next/link";
import type { Stay } from "@/lib/stays";

type StayCardProps = {
  stay: Stay;
};

export function StayCard({ stay }: StayCardProps) {
  return (
    <article className="group overflow-hidden rounded-3xl bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-soft">
      <Link href={`/stays/${stay.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-sand">
          <Image src={stay.image} alt={stay.name} fill className="object-cover transition duration-500 group-hover:scale-105" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
          <div className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold backdrop-blur">
            &#9733; {stay.rating}
          </div>
        </div>
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-coral">{stay.location}</p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold tracking-tight">{stay.name}</h2>
            <p className="whitespace-nowrap text-sm"><span className="font-black">${stay.pricePerNight}</span> / night</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink/60">{stay.description}</p>
        </div>
      </Link>
    </article>
  );
}

