"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochIcon } from "@/components/KoochIcon";
import { PropertyBookingPanel, propertyRoomsAnchorId } from "@/components/booking/PropertyBookingPanel";
import { useBookingUrlContext } from "@/hooks/useBookingUrlContext";
import { PropertyPhoto } from "@/components/booking/PropertyPhoto";
import { fetchPublicApi, PublicApiError, type PublicProperty, type PublicRoomType } from "@/lib/public-properties";
import { toPersianDigits } from "@/lib/persian-digits";
import styles from "./PropertyBookingLanding.module.css";
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
      <div className={styles.state} dir="rtl">
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
  const [selectedId, setSelectedId] = useState(property.roomTypes[0]?.id);
  const { dates, setDates, guests, setGuests, autoCheckInitialContextKey } = useBookingUrlContext("book", property.slug);
  const room = property.roomTypes.find((item) => item.id === selectedId) ?? property.roomTypes[0];
  const propertyImages = [property.coverImageUrl, ...[...property.images].sort((a, b) => Number(b.isCover) - Number(a.isCover)).map((image) => image.url)];
  const galleryFallback = propertyImages.find((url) => url?.trim()) ?? "";

  const showRoom = (selected: PublicRoomType) => {
    setSelectedId(selected.id);
    document.getElementById("room-preview")?.scrollIntoView({ block: "center" });
    document.getElementById("room-preview-title")?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.landing} dir="rtl">
      <a className={styles.skip} href="#booking">رفتن به بخش رزرو</a>
      <section aria-label={`معرفی ${property.name}`} className={`dark ${styles.hero}`}>
        <div aria-hidden="true" className={styles.backdrop}>
          <PropertyPhoto alt="" fill priority sizes="100vw" sources={propertyImages} />
        </div>
        <header className={styles.header}>
          <a className={styles.wordmark} href="#property-introduction">{property.name}</a>
          <PropertyGuestAccount slug={property.slug} propertyName={property.name} navigation={[
            { href: "#booking", label: "رزرو اقامت" },
            { href: "#property-introduction", label: "درباره اقامتگاه" },
            ...(property.address ? [{ href: "#property-location", label: "نشانی" }] : []),
          ]} />
        </header>

        <div className={styles.scene}>
          <nav aria-label="پیش‌نمایش اتاق‌ها" className={styles.roomNav}>
            <h2>اتاق‌های اقامتگاه</h2>
            <p className={styles.navHint}>برای آشنایی با هر اتاق انتخاب کنید</p>
            {property.roomTypes.length === 0 ? <p>هنوز اتاقی برای نمایش ثبت نشده است.</p> : (
              <div className={styles.roomList}>
                {property.roomTypes.map((item, index) => (
                  <KoochButton
                    aria-controls="room-preview"
                    aria-describedby={`room-nav-summary-${item.id}`}
                    aria-labelledby={`room-nav-name-${item.id}`}
                    aria-pressed={item.id === room?.id}
                    className={styles.roomChoice}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    variant="ghost"
                  >
                    <span className={styles.roomChoiceContent}>
                      <span aria-hidden="true" className={styles.roomNumber} dir="ltr">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={styles.roomChoiceText}>
                        <span className={styles.roomName} id={`room-nav-name-${item.id}`}>{item.name}</span>
                        <span aria-hidden="true" className={styles.roomSeparator} />
                        <span className={styles.roomSummary} id={`room-nav-summary-${item.id}`}>
                          ظرفیت: {toPersianDigits(item.maxAdults)} بزرگسال، {toPersianDigits(item.maxChildren)} کودک
                        </span>
                      </span>
                    </span>
                  </KoochButton>
                ))}
              </div>
            )}
          </nav>

          <div className={styles.identity}>
            <div className={styles.identityLead}>
              {property.city && <p className={styles.location}>{property.city}</p>}
              <h1>{property.name}</h1>
              {property.shortDescription && <p className={styles.intro}>{property.shortDescription}</p>}
              <a className={styles.bookingLink} href="#booking">انتخاب تاریخ و رزرو <KoochIcon name="search" className="h-5 w-5" /></a>
            </div>
            {room && (
              <section aria-labelledby="room-preview-title" className={styles.preview} id="room-preview">
                <div className={styles.previewPhoto}>
                  <PropertyPhoto alt={room.images[0]?.altText || room.name} fill sizes="(min-width: 1024px) 260px, (min-width: 640px) 35vw, 100vw" sources={[...room.images.map((image) => image.url), ...propertyImages]} />
                </div>
                <div className={styles.previewCopy}>
                  <h2 id="room-preview-title" tabIndex={-1}>{room.name}</h2>
                  <p>ظرفیت بزرگسال: {room.maxAdults.toLocaleString("fa-IR")} · ظرفیت کودک: {room.maxChildren.toLocaleString("fa-IR")}</p>
                  {room.description && <p className={styles.roomDescription}>{room.description}</p>}
                  {room.amenities.length > 0 && <ul aria-label="امکانات اتاق" className={styles.amenities}>{room.amenities.slice(0, 5).map((item) => <li key={item.id}>{item.name}</li>)}</ul>}
                </div>
              </section>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="booking-title" className={styles.booking} id="booking">
        <div className={styles.sectionHeading}>
          <h2 id="booking-title">اقامت خود را انتخاب کنید</h2>
          <p>تاریخ و تعداد مهمانان را مشخص کنید، سپس اتاق‌ها و تعداد مورد نیاز را انتخاب کنید.</p>
          <p>ادامه رزرو و ورود به حساب در سامانه رزرو مشترک انجام می‌شود و ظاهر صفحات بعدی ممکن است متفاوت باشد.</p>
          <p className={styles.previewNote}>پیش‌نمایش اتاق، آن را به رزرو اضافه نمی‌کند. ظرفیت و قیمت پس از انتخاب تاریخ بررسی می‌شود.</p>
        </div>
        {property.roomTypes.length > 0 ? (
          <PropertyBookingPanel autoCheckInitialContextKey={autoCheckInitialContextKey} entryKind="book" dates={dates} galleryFallback={galleryFallback} guests={guests} onDatesChange={setDates} onGuestsChange={setGuests} onShowRoomDetails={showRoom} propertyId={property.id} propertyName={property.name} propertySlug={property.slug} roomTypes={property.roomTypes}>
            {({ searchBar, roomSelection }) => <>{searchBar}<div className={styles.bookingRooms} id={propertyRoomsAnchorId} tabIndex={-1}>{roomSelection}</div></>}
          </PropertyBookingPanel>
        ) : <p className={styles.sectionHeading}>در حال حاضر اتاقی برای بررسی رزرو وجود ندارد.</p>}
      </section>

      <section aria-labelledby="introduction-title" className={styles.information} id="property-introduction">
        <div>
          <h2 id="introduction-title">درباره {property.name}</h2>
          {property.description && <p className={styles.description}>{property.description}</p>}
          {property.amenities.length > 0 && <ul aria-label="امکانات اقامتگاه" className={styles.propertyAmenities}>{property.amenities.map((item) => <li key={item.id}>{item.name}</li>)}</ul>}
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
