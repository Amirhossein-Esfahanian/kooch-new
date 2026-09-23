export type ReportStatus = "Pending" | "Confirmed" | "Rejected" | "Cancelled" | "Paid" | "Completed"
  | "PendingApproval" | "ApprovedAwaitingPayment" | "PaymentExpired" | "Draft" | "CapacityLost";
export type ReportStatusCount = { status: ReportStatus; count: number };
export interface AdminReservationReport {
  filters: {
    from: string | null;
    to: string | null;
    propertyId: number | null;
    status: ReportStatus | null;
    timeZone: string;
    fromUtcInclusive: string | null;
    toUtcExclusive: string | null;
  };
  summary: { totalCount: number; statusCounts: ReportStatusCount[] };
  trend: { date: string; count: number }[];
  properties: { propertyId: number; propertyName: string; count: number }[];
  statuses: ReportStatusCount[];
  reportableProperties: { id: number; name: string }[];
}
