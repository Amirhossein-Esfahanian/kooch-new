"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochIcon } from "@/components/KoochIcon";
import { KoochSvgIcon } from "@/components/KoochSvgIcon";
import { KoochDialog } from "@/components/KoochDialog";
import { MarketplaceWeatherCard } from "@/components/weather/MarketplaceWeatherCard";
import { PromotionCards } from "@/components/promotions/PromotionCards";
import {
  PropertyLocationMap,
  getValidPublicLocation,
} from "@/components/property/PropertyLocationMap";
import type { PublicProperty } from "@/lib/public-properties";
import { MarketplacePropertyGallery } from "./MarketplacePropertyGallery";
import {
  propertySections,
  useMarketplacePropertyNavigation,
} from "./useMarketplacePropertyNavigation";
import styles from "./MarketplacePropertyDetail.module.css";

function PropertyAmenityIcon({ icon }: { icon?: string | null }) {
  return icon &&
    /^\/(?!\/)[\w/.-]+\.svg$/i.test(icon) &&
    !icon.includes("..") ? (
    <KoochSvgIcon size="sm" src={icon} />
  ) : (
    <KoochIcon className="h-4 w-4" name="info" />
  );
}

const propertyTypes: Record<string, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "اقامتگاه بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};
const viewLabels: Record<string, string> = {
  CourtyardView: "نمای حیاط",
  GardenView: "نمای باغ",
  CityView: "نمای شهر",
  MountainView: "نمای کوه",
  DesertView: "نمای کویر",
};

export function MarketplacePropertyDetail({
  property,
  resultsHref,
  searchBar,
  roomSelection,
}: {
  property: PublicProperty;
  resultsHref: string;
  searchBar: ReactNode;
  roomSelection: ReactNode;
}) {
  const navigation = useMarketplacePropertyNavigation();
  const [allAmenitiesOpen, setAllAmenitiesOpen] = useState(false);
  const introduction = property.descriptionSections.filter(
    (section) => section.sectionType === "PropertyIntroduction",
  );
  const notes = property.descriptionSections.filter(
    (section) => section.sectionType === "ImportantNotes",
  );
  const groups = new Map<string, PublicProperty["amenities"]>();
  for (const amenity of property.amenities)
    groups.set(amenity.category, [
      ...(groups.get(amenity.category) ?? []),
      amenity,
    ]);
  const accessibility = [
    ["مناسب ویلچر", property.isWheelchairAccessible],
    ["آسانسور", property.hasElevator],
    ["اتاق همکف", property.hasGroundFloorRoom],
    ["سرویس مناسب افراد کم‌توان", property.hasAccessibleBathroom],
  ] as const;
  const location = getValidPublicLocation(
    property.latitude,
    property.longitude,
  );
  const mapUrl = location
    ? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${location.latitude},${location.longitude}` })}`
    : null;

  return (
    <div
      className={styles.page}
      data-header-collapsed={navigation.collapsed}
      dir="rtl"
      ref={navigation.rootRef}
    >
      <div className={styles.searchShell} ref={navigation.searchRef}>
        {searchBar}
      </div>
      <div className={styles.container}>
        <header className={styles.identity}>
          <h1 tabIndex={-1}>{property.name}</h1>
          <Link className={styles.backLink} href={resultsHref}>
            بازگشت به نتایج جست‌وجو
          </Link>
        </header>
        <MarketplacePropertyGallery
          images={property.images}
          name={property.name}
        />
      </div>
      <div aria-hidden="true" ref={navigation.sentinelRef} />
      <nav
        aria-label="بخش‌های اقامتگاه"
        className={styles.sectionNavigation}
        data-stuck={navigation.stuck}
        ref={navigation.navigationRef}
      >
        <div className={styles.navigationInner}>
          <div
            className={styles.sectionLinks}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              const links = Array.from(
                event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"),
              );
              const current = links.indexOf(
                document.activeElement as HTMLAnchorElement,
              );
              if (current < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? links.length - 1
                    : (current +
                        (event.key === "ArrowLeft" ? 1 : -1) +
                        links.length) %
                      links.length;
              links[next]?.focus();
            }}
          >
            {propertySections.map((section) => (
              <a
                aria-current={
                  navigation.active === section.id ? "location" : undefined
                }
                href={`#${section.id}`}
                key={section.id}
                onClick={(event) => {
                  event.preventDefault();
                  navigation.navigate(section.id);
                }}
              >
                {section.label}
              </a>
            ))}
          </div>
          <KoochButton
            className={styles.topButton}
            onClick={navigation.backToTop}
            variant="ghost"
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M12 20V4m-7 7l7-7 7 7" />
            </svg>
            <span>بازگشت به بالا</span>
          </KoochButton>
        </div>
      </nav>
      <div className={`${styles.container} ${styles.contentGrid}`}>
        <div className={styles.mainContent}>
          <section
            aria-labelledby="overview-title"
            className={styles.section}
            id="property-overview"
            tabIndex={-1}
          >
            <h2 id="overview-title">درباره اقامتگاه</h2>
            <p className={styles.propertyName}>{property.name}</p>
            <div className={styles.overviewMeta}>
              <span>
                {propertyTypes[property.propertyType] ?? property.propertyType}
              </span>
              {property.englishName && (
                <span dir="ltr">{property.englishName}</span>
              )}
            </div>
            {property.description && (
              <p className={styles.prose}>{property.description}</p>
            )}
            {introduction
              .filter(
                (section) =>
                  section.content.trim() !== property.description.trim(),
              )
              .map((section, index) => (
                <article key={index}>
                  {section.title && <h3>{section.title}</h3>}
                  <p className={styles.prose}>{section.content}</p>
                </article>
              ))}
            {!property.description && !introduction.length && (
              <p className={styles.unavailable}>
                توضیحاتی برای این اقامتگاه ثبت نشده است.
              </p>
            )}
            {notes.map((note, index) => (
              <article key={index}>
                <h3>{note.title || "نکات مهم"}</h3>
                <p className={styles.prose}>{note.content}</p>
              </article>
            ))}
            <PromotionCards
              className="mt-5"
              promotions={property.promotions}
              title="پیشنهادهای فعال این اقامتگاه"
            />
          </section>

          <section
            aria-labelledby="highlights-title"
            className={styles.section}
            id="property-highlights"
            tabIndex={-1}
          >
            <h2 id="highlights-title">ویژگی‌های برجسته</h2>
            {property.commonAreas.length > 0 && (
              <section>
                <h3>فضاهای مشترک</h3>
                <div className={styles.facilityGroups}>
                  {property.commonAreas.map((area) => (
                    <article key={area.id}>
                      <h4>{area.name}</h4>
                      {area.description && (
                        <p className={styles.prose}>{area.description}</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
            {accessibility.some(([, value]) => value !== null) && (
              <section>
                <h3>دسترسی‌پذیری</h3>
                <dl className={styles.facts}>
                  {accessibility
                    .filter(([, value]) => value !== null)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value ? "دارد" : "ندارد"}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            )}
          </section>

          <section
            aria-labelledby="facilities-title"
            className={styles.section}
            id="property-facilities"
            tabIndex={-1}
          >
            <div className={styles.sectionTitleRow}>
              <h2 id="facilities-title">امکانات</h2>
              {property.amenities.length > 0 && (
                <KoochButton
                  aria-haspopup="dialog"
                  className={styles.seeAllButton}
                  onClick={() => setAllAmenitiesOpen(true)}
                  variant="ghost"
                >
                  مشاهده همه
                </KoochButton>
              )}
            </div>
            {property.amenities.length ? (
              <ul className={styles.amenities}>
                {property.amenities.slice(0, 6).map((amenity) => (
                  <li key={amenity.id}>
                    <PropertyAmenityIcon icon={amenity.icon} />
                    {amenity.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.unavailable}>هنوز امکاناتی ثبت نشده است.</p>
            )}
          </section>
        </div>

        <section
          aria-labelledby="property-rooms-title"
          className={`${styles.section} ${styles.fullWidth} ${styles.rooms} scroll-mt-80 sm:scroll-mt-64 xl:scroll-mt-44`}
          id="property-rooms"
          tabIndex={-1}
        >
          <h2 id="property-rooms-title">اتاق‌ها</h2>
          {property.roomTypes.length ? (
            roomSelection
          ) : (
            <p className={styles.unavailable}>هنوز اتاق فعالی ثبت نشده است.</p>
          )}
        </section>

        <div className={`${styles.fullWidth} min-w-0`}>
          <MarketplaceWeatherCard />
        </div>

        <section
          aria-labelledby="location-title"
          className={`${styles.section} ${styles.fullWidth} min-w-0`}
          id="property-location"
          tabIndex={-1}
        >
          <h2 id="location-title">موقعیت مکانی</h2>
          <p className={styles.prose}>
            {property.city}
            {property.country ? `، ${property.country}` : ""}
          </p>
          {property.settings.length > 0 && (
            <section aria-labelledby="property-settings-title">
              <h3 id="property-settings-title">بافت و موقعیت محیطی</h3>
              <ul className={styles.tags}>
                {property.settings.map((setting) => (
                  <li key={setting.id}>{setting.name}</li>
                ))}
              </ul>
            </section>
          )}
          {property.views.length > 0 && (
            <section>
              <h3>چشم‌اندازها</h3>
              <ul className={styles.tags}>
                {property.views.map((view) => (
                  <li key={view}>{viewLabels[view] ?? view}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="min-w-0">
            <h3>مکان‌های نزدیک</h3>
            {property.nearbyPlaces.length ? (
              <div className={`${styles.tableScroller} overflow-x-auto`}>
                <table className="min-w-[520px]">
                  <thead>
                    <tr>
                      <th>مکان</th>
                      <th>پیاده</th>
                      <th>با خودرو</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.nearbyPlaces.map((place) => (
                      <tr key={place.id}>
                        <th scope="row">{place.title}</th>
                        <td>
                          {place.walkingMinutes != null
                            ? `${place.walkingMinutes} دقیقه`
                            : "-"}
                        </td>
                        <td>
                          {place.drivingMinutes != null
                            ? `${place.drivingMinutes} دقیقه`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.unavailable}>مکان نزدیکی ثبت نشده است.</p>
            )}
          </section>
        </section>

        <section
          aria-labelledby="policies-title"
          className={`${styles.section} ${styles.fullWidth}`}
          id="property-policies"
          tabIndex={-1}
        >
          <h2 id="policies-title">قوانین و مقررات</h2>
          <dl className={styles.facts}>
            <div>
              <dt>ساعت ورود</dt>
              <dd>{property.checkInTime?.slice(0, 5) ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>ساعت خروج</dt>
              <dd>{property.checkOutTime?.slice(0, 5) ?? "ثبت نشده"}</dd>
            </div>
            {(property.regularReceptionFrom ||
              property.regularReceptionUntil) && (
              <div>
                <dt>ساعت پذیرش</dt>
                <dd>
                  {property.regularReceptionFrom?.slice(0, 5) ?? "ثبت نشده"} تا{" "}
                  {property.regularReceptionUntil?.slice(0, 5) ?? "ثبت نشده"}
                </dd>
              </div>
            )}
          </dl>
          {property.freeChildAgeLimit != null && (
            <p className={styles.prose}>
              محدودهٔ سنی کودک رایگان:{" "}
              {property.freeChildAgeLimit.toLocaleString("fa-IR")} سال
              {property.maxFreeChildren != null
                ? `؛ حداکثر ${property.maxFreeChildren.toLocaleString("fa-IR")} کودک`
                : ""}
              .
            </p>
          )}
          <p className={styles.unavailable}>
            جزئیات سیاست لغو در حال حاضر برای نمایش در دسترس نیست.
          </p>
        </section>
        <section
          aria-labelledby="reviews-title"
          className={`${styles.section} ${styles.fullWidth}`}
          id="property-reviews"
          tabIndex={-1}
        >
          <h2 id="reviews-title">نظرات مهمانان</h2>
          <p className={styles.unavailable}>
            اطلاعات نظرات و امتیاز مهمانان در حال حاضر برای نمایش در دسترس نیست.
          </p>
        </section>
        <aside aria-label="خلاصه اقامتگاه و موقعیت" className={styles.sidebar}>
          <KoochCard className={styles.sidebarCard}>
            <h2>امتیاز و نظرات</h2>
            <p className={styles.prose}>امتیاز قابل‌نمایشی در دسترس نیست.</p>
            <a
              className={styles.textLink}
              href="#property-reviews"
              onClick={(event) => {
                event.preventDefault();
                navigation.navigate("property-reviews");
              }}
            >
              مشاهده بخش نظرات
            </a>
          </KoochCard>
          <KoochCard className={styles.sidebarCard}>
            {mapUrl ? (
              <>
                <PropertyLocationMap
                  latitude={property.latitude}
                  longitude={property.longitude}
                  propertyName={property.name}
                />
                <a
                  className={styles.textLink}
                  href={mapUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  باز کردن در نقشه
                </a>
              </>
            ) : (
              <>
                <h2>موقعیت اقامتگاه</h2>
                <p className={styles.unavailable}>
                  موقعیت دقیق روی نقشه ثبت نشده است.
                </p>
              </>
            )}
            <p className={styles.address}>
              {property.address}، {property.city}
            </p>
            <a
              className={styles.textLink}
              href="#property-location"
              onClick={(event) => {
                event.preventDefault();
                navigation.navigate("property-location");
              }}
            >
              اطلاعات محدوده و مکان‌های نزدیک
            </a>
          </KoochCard>
        </aside>
      </div>
      <KoochDialog
        contentClassName={styles.amenitiesDialog}
        onOpenChange={setAllAmenitiesOpen}
        open={allAmenitiesOpen}
        size="md"
        title="همه امکانات اقامتگاه"
      >
        <div className={styles.amenityCategories}>
          {[...groups].map(([category, amenities]) => (
            <section key={category}>
              <h3>{category}</h3>
              <ul className={styles.amenities}>
                {amenities.map((amenity) => (
                  <li key={amenity.id}>
                    <PropertyAmenityIcon icon={amenity.icon} />
                    {amenity.name}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </KoochDialog>
    </div>
  );
}
