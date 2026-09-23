using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reports;

public sealed class AdminReservationReportQuery
{
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
    public int? PropertyId { get; set; }
    public ReservationStatus? Status { get; set; }
}

public sealed record AdminReportFilters(
    DateOnly? From, DateOnly? To, int? PropertyId, ReservationStatus? Status,
    string TimeZone, DateTime? FromUtcInclusive, DateTime? ToUtcExclusive);

public sealed record AdminReportStatusCount(ReservationStatus Status, int Count);
public sealed record AdminReportSummary(int TotalCount, IReadOnlyList<AdminReportStatusCount> StatusCounts);
public sealed record AdminReportTrend(DateOnly Date, int Count);
public sealed record AdminReportPropertyCount(int PropertyId, string PropertyName, int Count);
public sealed record AdminReportPropertyOption(int Id, string Name);
public sealed record AdminReservationReportResponse(
    AdminReportFilters Filters,
    AdminReportSummary Summary,
    IReadOnlyList<AdminReportTrend> Trend,
    IReadOnlyList<AdminReportPropertyCount> Properties,
    IReadOnlyList<AdminReportStatusCount> Statuses,
    IReadOnlyList<AdminReportPropertyOption> ReportableProperties);
