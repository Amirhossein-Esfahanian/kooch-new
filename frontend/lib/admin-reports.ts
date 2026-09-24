export type ReportStatus = "Pending" | "Confirmed" | "Rejected" | "Cancelled" | "Paid" | "Completed"
  | "PendingApproval" | "ApprovedAwaitingPayment" | "PaymentExpired" | "Draft" | "CapacityLost";
export type ReportPropertyType = "TraditionalHouse" | "BoutiqueHotel" | "EcoLodge" | "Hotel" | "Villa" | "Apartment";
export type ReportStatusCount = { status: ReportStatus; count: number };
export type AdminReservationReportFilters = {
  startDate: string | null;
  endDate: string | null;
  propertyIds: string[];
  propertyTypes: ReportPropertyType[];
  status: ReportStatus | "";
};

export function buildAdminReservationReportPath(filters: AdminReservationReportFilters) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("from", filters.startDate);
  if (filters.endDate) params.set("to", filters.endDate);
  filters.propertyIds.forEach((propertyId) => params.append("propertyIds", propertyId));
  filters.propertyTypes.forEach((propertyType) => params.append("propertyTypes", propertyType));
  if (filters.status) params.set("status", filters.status);

  return `/admin/reports/reservations${params.size ? `?${params}` : ""}`;
}

export interface AdminReservationReport {
  filters: {
    from: string | null;
    to: string | null;
    propertyIds: number[];
    propertyTypes: ReportPropertyType[];
    status: ReportStatus | null;
    timeZone: string;
    fromUtcInclusive: string | null;
    toUtcExclusive: string | null;
  };
  summary: {
    totalCount: number;
    bookingValue: number | null;
    bookingValueCurrency: string | null;
    bookingValueHasMixedCurrencies: boolean;
    statusCounts: ReportStatusCount[];
  };
  trend: { date: string; count: number }[];
  properties: { propertyId: number; propertyName: string; count: number }[];
  statuses: ReportStatusCount[];
  reportableProperties: { id: number; name: string }[];
}
