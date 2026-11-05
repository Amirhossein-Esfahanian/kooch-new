"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochIcon } from "@/components/KoochIcon";
import { PropertyBookingPanel, propertyRoomsAnchorId } from "@/components/booking/PropertyBookingPanel";
import { useBookingUrlContext } from "@/hooks/useBookingUrlContext";
import { PropertyPhoto } from "@/components/booking/PropertyPhoto";
import { fetchPublicApi, PublicApiError, type PublicProperty, type PublicRoomType } from "@/lib/public-properties";
import styles from "./PropertyBookingLanding.module.css";
import guestStyles from "./PropertyDirectGuest.module.css";
import { PropertyGuestAccount } from "@/components/booking/PropertyGuestAccount";

type Resource = { slug: string; property?: PublicProperty; error?: "missing" | "failed" };

export function PropertyBookingLanding({ initialProperty, initialSlug }: { initialProperty?: PublicProperty; initialSlug?: string } = {}) {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const serverProperty = initialProperty?.status === "Approved" && (initialSlug ?? initialProperty.slug) === slug
    ? initialProperty : undefined;
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<Resource>({ slug: "" });

  useEffect(() => {
    if (serverProperty) return;
    let current = true;
    setResource({ slug });
    fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(slug)}`)
      .then((property) => {
        if (current) setResource(property.status === "Approved" ? { slug, property } : { slug, error: "missing" });
      })
      .catch((error: unknown) => {
        if (current) setResource({ slug, error: error instanceof PublicApiError && error.status === 404 ? "missing" : "failed" });
      });
    return () => { current = false; };
  }, [slug, attempt, serverProperty]);

  const current = serverProperty ? { slug, property: serverProperty } : resource.slug === slug ? resource : { slug };
  if (!current.property) {
    return (
      <div className={`dark ${guestStyles.scope} ${styles.state}`} dir="rtl">
        {current.error ? (
          <div className="max-w-lg space-y-5">
            <KoochAlert title={current.error === "missing" ? "اقامتگاه در دسترس نیست" : "دریافت اطلاعات انجام نشد"} variant="warning">
              {current.error === "missing" ? "این اقامتگاه برای نمایش و رزرو عمومی در دسترس نیست." : "ارتباط با سامانه برقرار نشد. دوباره تلاش کنید."}
            </KoochAlert>
            <KoochButton onClick={() => setAttempt((value) => value + 1)}>تلاش دوباره</KoochButton>
          </div>
        ) : <p aria-busy="true" role="status">در حال دریافت اقامتگاه…</p>}
      </div>
    );
  }
  return <LandingContent key={current.property.slug} property={current.property} />;
}

function LandingContent({ property }: { property: PublicProperty }) {
  const [selectedId, setSelectedId] = useState<number>();
  const { dates, setDates, guests, setGuests, autoCheckInitialContextKey } = useBookingUrlContext("book", property.slug);
  const room = property.roomTypes.find((item) => item.id === selectedId);
  const propertyImages = [property.coverImageUrl, ...[...property.images].sort((a, b) => Number(b.isCover) - Number(a.isCover)).map((image) => image.url)];
  const galleryFallback = propertyImages.find((url) => url?.trim()) ?? "";

  const showRoom = (selected: PublicRoomType) => {
    setSelectedId(selected.id);
  };

  return (
    <div className={`dark ${guestStyles.scope} ${styles.landing}`} dir="rtl">
      <a className={styles.skip} href="#booking">رفتن به بخش رزرو</a>
      <section aria-label={`معرفی ${property.name}`} className={styles.hero}>
        <header className={styles.header}>
          <a className={styles.wordmark} dir="auto" href="#property-introduction">{property.name}</a>
          <PropertyGuestAccount slug={property.slug} propertyName={property.name} navigation={[
            { href: "#booking", label: "رزرو اقامت" },
            { href: "#property-rooms", label: "اتاق‌ها" },
            ...(property.amenities.length ? [{ href: "#property-facilities", label: "امکانات" }] : []),
            { href: "#property-introduction", label: "درباره اقامتگاه" },
            ...(property.address ? [{ href: "#property-location", label: "نشانی" }] : []),
          ]} />
          <a className={`${styles.headerBooking} ${guestStyles.goldAction}`} href="#booking">بررسی موجودی</a>
        </header>

        <div className={styles.scene}>
          <div className={styles.heroPhoto}>
            <PropertyPhoto alt={property.name} fill priority sizes="100vw" sources={propertyImages} />
          </div>
          <div className={styles.identity}>
            <div className={styles.identityLead}>
              <h1 className={/[\u0600-\u06ff]/.test(property.name) ? undefined : styles.latinTitle} dir="auto">{property.name}</h1>
              {property.city && <p className={styles.location}>{property.city}</p>}
              {(property.shortDescription || property.description) && <p className={styles.intro}>{property.shortDescription || property.description}</p>}
              <a className={`${styles.bookingLink} ${guestStyles.goldAction}`} href="#booking">انتخاب تاریخ و رزرو <KoochIcon name="search" className="h-5 w-5" /></a>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="booking-title" className={styles.booking} id="booking">
        <h2 className="sr-only" id="booking-title">اقامت خود را انتخاب کنید</h2>
        {property.roomTypes.length > 0 ? (
          <PropertyBookingPanel portalClassName={`dark ${guestStyles.scope}`} autoCheckInitialContextKey={autoCheckInitialContextKey} entryKind="book" dates={dates} galleryFallback={galleryFallback} guests={guests} onDatesChange={setDates} onGuestsChange={setGuests} onShowRoomDetails={showRoom} propertyId={property.id} propertyName={property.name} propertySlug={property.slug} roomTypes={property.roomTypes}>
            {({ searchBar, roomSelection }) => <>
              <div className={styles.search}>{searchBar}</div>
              <div className={styles.roomsHeading}><h2>اتاق‌های {property.name}</h2><p>قیمت و موجودی برای تاریخ و تعداد مهمانان انتخاب‌شده بررسی می‌شود.</p></div>
              <div className={styles.bookingRooms} data-room-layout={property.roomTypes.length === 1 ? "single" : property.roomTypes.length === 2 ? "pair" : "grid"} id={propertyRoomsAnchorId} tabIndex={-1}>{roomSelection}</div>
            </>}
          </PropertyBookingPanel>
        ) : <p className={styles.sectionHeading}>در حال حاضر اتاقی برای بررسی رزرو وجود ندارد.</p>}
      </section>

      {property.amenities.length > 0 && <section className={styles.facilities} id="property-facilities" aria-labelledby="facilities-title">
        <h2 id="facilities-title">امکانات و خدمات اقامتگاه</h2>
        <ul>{property.amenities.map((item) => <li key={item.id}><KoochIcon name="success" className="h-7 w-7" /><span>{item.name}</span></li>)}</ul>
      </section>}

      <KoochDialog open={Boolean(room)} onOpenChange={(open) => { if (!open) setSelectedId(undefined); }} title={room?.name ?? "جزئیات اتاق"}
        size="md" contentClassName={`dark ${guestStyles.scope} ${styles.roomDialog}`} bodyClassName={styles.roomDialogBody}>
      {room && <div className={styles.preview}>
        <div className={styles.previewPhoto}>
          <PropertyPhoto alt={room.images[0]?.altText || room.name} fill sizes="(min-width: 768px) 40vw, 100vw" sources={[...room.images.map((image) => image.url), ...propertyImages]} />
        </div>
        <div className={styles.previewCopy}>
          <p>ظرفیت بزرگسال: {room.maxAdults.toLocaleString("fa-IR")} · ظرفیت کودک: {room.maxChildren.toLocaleString("fa-IR")}</p>
          {room.description && <p className={styles.roomDescription}>{room.description}</p>}
          {room.notes && <p>{room.notes}</p>}
          {room.amenities.length > 0 && <ul aria-label="امکانات اتاق" className={styles.amenities}>{room.amenities.map((item) => <li key={item.id}>{item.name}</li>)}</ul>}
          <p className={styles.previewNote}>پیش‌نمایش اتاق، آن را به رزرو اضافه نمی‌کند. ظرفیت و قیمت پس از انتخاب تاریخ بررسی می‌شود.</p>
          <KoochButton className="mt-4" onClick={() => setSelectedId(undefined)} variant="outline">بازگشت به انتخاب اتاق</KoochButton>
        </div>
      </div>}
      </KoochDialog>

      <section aria-labelledby="introduction-title" className={styles.information} id="property-introduction">
        <div>
          <h2 id="introduction-title">درباره {property.name}</h2>
          {property.description && <p className={styles.description}>{property.description}</p>}
          {property.descriptionSections.filter((item) => item.sectionType === "ImportantNotes").sort((a, b) => a.sortOrder - b.sortOrder).map((item, index) => <div className="mt-6" key={`${item.title}-${index}`}><h3 className="font-bold">{item.title}</h3><p className={styles.description}>{item.content}</p></div>)}
        </div>
        <div className={styles.practical}>
          {(property.checkInTime || property.checkOutTime) && <div><h3>زمان اقامت</h3><dl>{property.checkInTime && <><dt>ورود از ساعت</dt><dd>{property.checkInTime.slice(0, 5)}</dd></>}{property.checkOutTime && <><dt>خروج تا ساعت</dt><dd>{property.checkOutTime.slice(0, 5)}</dd></>}</dl></div>}
          {property.address && <div id="property-location"><h3>نشانی اقامتگاه</h3><p>{property.city}، {property.address}</p></div>}
        </div>
      </section>
    </div>
  );
}
