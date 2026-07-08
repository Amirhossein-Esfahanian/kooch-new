using Kooch.Api.Dtos.Reservations;

namespace Kooch.Api.Services;

public interface IReservationPricingService
{
    Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
        ReservationPricePreviewRequest request,
        CancellationToken cancellationToken = default);
}
