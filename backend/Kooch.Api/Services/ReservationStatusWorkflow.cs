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
            [ReservationStatus.OnHold] = new HashSet<ReservationStatus>(),
            [ReservationStatus.PendingApproval] = new HashSet<ReservationStatus>
            {
                ReservationStatus.ApprovedAwaitingPayment
            },
            [ReservationStatus.ApprovedAwaitingPayment] = new HashSet<ReservationStatus>
            {
                ReservationStatus.Confirmed,
                ReservationStatus.PaymentExpired
            },
            [ReservationStatus.Completed] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Cancelled] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Rejected] = new HashSet<ReservationStatus>(),
            [ReservationStatus.Expired] = new HashSet<ReservationStatus>(),
            [ReservationStatus.PaymentExpired] = new HashSet<ReservationStatus>()
        };

    public IReadOnlyCollection<ReservationStatus> GetAllowedTransitions(ReservationStatus from)
    {
        return AllowedTransitions.TryGetValue(from, out var allowedStatuses)
            ? allowedStatuses.ToArray()
            : Array.Empty<ReservationStatus>();
    }

    public bool CanTransition(ReservationStatus from, ReservationStatus to)
    {
        return AllowedTransitions.TryGetValue(from, out var allowedStatuses) &&
               allowedStatuses.Contains(to);
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
            ReservationStatus.OnHold => "On hold",
            ReservationStatus.Expired => "Expired",
            ReservationStatus.PendingApproval => "Pending approval",
            ReservationStatus.ApprovedAwaitingPayment => "Approved awaiting payment",
            ReservationStatus.PaymentExpired => "Payment expired",
            _ => status.ToString()
        };
}
