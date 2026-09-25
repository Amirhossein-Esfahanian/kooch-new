using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationVoucherService
{
    Task<ReservationVoucher> IssueAsync(
        Reservation reservation,
        Payment payment,
        PaymentItem? paymentItem,
        CancellationToken cancellationToken = default);
}
