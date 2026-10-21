namespace Kooch.Api.Dtos.Reservations;

public sealed class OwnerPropertyOperationalSummaryResponse
{
    public DateOnly BusinessDate { get; init; }
    public int PendingApprovalCount { get; init; }
    public int ScheduledArrivalsTodayCount { get; init; }
    public int ScheduledDeparturesTodayCount { get; init; }
}
