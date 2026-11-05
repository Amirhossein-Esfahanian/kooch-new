import type { AccountBookingSession } from "@/lib/booking-sessions";

export type DirectSessionProperty = { id: number; slug: string; name: string };
export type BookingPaymentPageKind = "success" | "payment-failure" | "mock-payment";

export function isDirectSessionForProperty(session: AccountBookingSession, sessionCode: string, property: DirectSessionProperty) {
  return session.sessionCode === sessionCode && session.commissionType === 2 &&
    session.property.propertyId === property.id && session.property.slug === property.slug;
}

export function directSessionHref(property: DirectSessionProperty, sessionCode: string, kind?: BookingPaymentPageKind) {
  return `/book/${encodeURIComponent(property.slug)}/reservations/${encodeURIComponent(sessionCode)}${kind ? `/${kind}` : ""}`;
}
