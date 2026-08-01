using Kooch.Api.Dtos.BookingSessions;

namespace Kooch.Api.Services;

public interface IBookingSessionQueryService
{
    Task<BookingSessionDetailsResponse> GetByIdAsync(
        int bookingSessionId,
        CancellationToken cancellationToken = default);

    Task<BookingSessionDetailsResponse> GetBySessionCodeAsync(
        string sessionCode,
        CancellationToken cancellationToken = default);
}
