using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal sealed class BookingSessionPayableScopeResolver : IBookingSessionPayableScopeResolver
{
    public BookingSessionPayableScope Resolve(
        string sessionCurrency,
        IReadOnlyList<BookingSessionPayableChild> children,
        DateTime utcNow)
    {
        ArgumentNullException.ThrowIfNull(children);

        var allChildren = children.ToArray();
        var payableChildren = allChildren
            .Where(child => child.Status == ReservationStatus.ApprovedAwaitingPayment)
            .ToArray();
        var rejectedChildren = allChildren
            .Where(child => child.Status == ReservationStatus.Rejected)
            .ToArray();
        var pendingApprovalChildren = allChildren
            .Where(child => child.Status == ReservationStatus.PendingApproval)
            .ToArray();
        var unsupportedChildren = allChildren
            .Where(child => child.Status is not (
                ReservationStatus.ApprovedAwaitingPayment or
                ReservationStatus.Rejected or
                ReservationStatus.PendingApproval))
            .ToArray();
        var earliestPayableDeadlineUtc = payableChildren
            .Where(child => child.PaymentExpiresAtUtc.HasValue)
            .Select(child => child.PaymentExpiresAtUtc!.Value)
            .DefaultIfEmpty()
            .Min();
        var hasValidDeadlines = payableChildren.All(child =>
            child.PaymentExpiresAtUtc.HasValue &&
            child.PaymentExpiresAtUtc.Value > utcNow);
        var normalizedSessionCurrency = NormalizeCurrency(sessionCurrency);
        var payableCurrencies = payableChildren
            .Select(child => NormalizeCurrency(child.Currency))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var payableCurrency = payableCurrencies.Length == 1
            ? payableCurrencies[0]
            : null;
        var hasConsistentCurrency = payableCurrency is not null &&
            string.Equals(
                payableCurrency,
                normalizedSessionCurrency,
                StringComparison.Ordinal);
        var isApprovalPhaseClosed = pendingApprovalChildren.Length == 0;
        var canContinue =
            payableChildren.Length > 0 &&
            rejectedChildren.Length > 0 &&
            isApprovalPhaseClosed &&
            unsupportedChildren.Length == 0 &&
            hasConsistentCurrency &&
            hasValidDeadlines;

        return new BookingSessionPayableScope(
            allChildren,
            payableChildren,
            rejectedChildren,
            pendingApprovalChildren,
            unsupportedChildren,
            isApprovalPhaseClosed,
            canContinue,
            payableCurrency,
            payableChildren.Sum(child => child.FinalAmount),
            earliestPayableDeadlineUtc == default ? null : earliestPayableDeadlineUtc);
    }

    private static string? NormalizeCurrency(string? currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }
}
