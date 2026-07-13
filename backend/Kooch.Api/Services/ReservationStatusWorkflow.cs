using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public class ReservationStatusWorkflow : IReservationStatusWorkflow
{
    private static readonly IReadOnlyDictionary<ReservationStatus, IReadOnlySet<ReservationStatus>> AllowedTransitions =
        new Dictionary<ReservationStatus, IReadOnlySet<ReservationStatus>>
        {
            [ReservationStatus.Pending] = new HashSet<ReservationStatus>
            {
                ReservationStatus.Confirmed,
                ReservationStatus.Cancelled
            },
            [ReservationStatus.Confirmed] = new HashSet<ReservationStatus>
            {
                ReservationStatus.Cancelled,
                ReservationStatus.Completed
            },
            [ReservationStatus.Paid] = new HashSet<ReservationStatus>
            {
                ReservationStatus.Cancelled
            },
            [ReservationStatus.PendingApproval] = new HashSet<ReservationStatus>
            {
                ReservationStatus.ApprovedAwaitingPayment
            },
            [ReservationStatus.ApprovedAwaitingPayment] = new HashSet<ReservationStatus>
            {
                ReservationStatus.PaymentExpired
            },
            [ReservationStatus.Completed] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Cancelled] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Rejected] = new HashSet<ReservationStatus>(),
            [ReservationStatus.PaymentExpired] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Draft] = new HashSet<ReservationStatus>
            {
                ReservationStatus.PendingApproval,
                ReservationStatus.ApprovedAwaitingPayment,
                ReservationStatus.Cancelled
            },
            [ReservationStatus.CapacityLost] = new HashSet<ReservationStatus>()
        };

    public IReadOnlyCollection<ReservationStatus> GetAllowedTransitions(ReservationStatus from)
    {
        var normalizedFrom = ReservationStatusNormalizer.Normalize(from);
        return AllowedTransitions.TryGetValue(normalizedFrom, out var allowedStatuses)
            ? allowedStatuses.ToArray()
            : Array.Empty<ReservationStatus>();
    }

    public bool CanTransition(ReservationStatus from, ReservationStatus to)
    {
        var normalizedFrom = ReservationStatusNormalizer.Normalize(from);
        var normalizedTo = ReservationStatusNormalizer.Normalize(to);
        return AllowedTransitions.TryGetValue(normalizedFrom, out var allowedStatuses) &&
               allowedStatuses.Contains(normalizedTo);
    }

    public void ValidateTransition(ReservationStatus from, ReservationStatus to)
    {
        if (CanTransition(from, to))
        {
            return;
        }

        throw new InvalidOperationException(
            $"Invalid reservation status transition from {GetStatusLabel(from)} to {GetStatusLabel(to)}.");
    }

    private static string GetStatusLabel(ReservationStatus status) =>
        status switch
        {
            ReservationStatus.Pending => "Pending",
            ReservationStatus.Confirmed => "Confirmed",
            ReservationStatus.Rejected => "Rejected",
            ReservationStatus.Cancelled => "Cancelled",
            ReservationStatus.Paid => "Paid",
            ReservationStatus.Completed => "Completed",
            ReservationStatus.PendingApproval => "Pending approval",
            ReservationStatus.ApprovedAwaitingPayment => "Approved awaiting payment",
            ReservationStatus.PaymentExpired => "Payment expired",
            ReservationStatus.Draft => "Draft",
            ReservationStatus.CapacityLost => "Capacity lost",
            _ => ReservationStatusNormalizer.Normalize(status).ToString()
        };
}
