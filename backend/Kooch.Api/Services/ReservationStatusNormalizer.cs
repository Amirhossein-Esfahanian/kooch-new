using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public static class ReservationStatusNormalizer
{
    public const ReservationStatus LegacyPendingApproval = (ReservationStatus)6;
    public const ReservationStatus LegacyPaymentExpired = (ReservationStatus)7;

    public static ReservationStatus Normalize(ReservationStatus status) =>
        status switch
        {
            LegacyPendingApproval => ReservationStatus.PendingApproval,
            LegacyPaymentExpired => ReservationStatus.PaymentExpired,
            _ => status
        };
}
