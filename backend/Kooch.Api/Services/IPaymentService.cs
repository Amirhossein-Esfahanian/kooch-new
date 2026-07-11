using Kooch.Api.Dtos.Payments;

namespace Kooch.Api.Services;

public interface IPaymentService
{
    Task<PaymentConfirmationResponse> ConfirmSuccessfulPaymentAsync(
        int reservationId,
        PaymentConfirmationRequest request,
        CancellationToken cancellationToken = default);

    Task<ReservationPaymentPreparationResponse> GetReservationPaymentPreparationAsync(
        string reservationNumber,
        string? rawToken,
        CancellationToken cancellationToken = default);

    Task<ReservationPaymentPlaceholderResponse> ContinueReservationPaymentAsync(
        string reservationNumber,
        string? rawToken,
        CancellationToken cancellationToken = default);
}
