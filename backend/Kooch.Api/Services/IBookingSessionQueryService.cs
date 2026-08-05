using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;

namespace Kooch.Api.Services;

public interface IBookingSessionQueryService
{
    Task<BookingSessionDetailsResponse> GetByIdAsync(
        int bookingSessionId,
        CancellationToken cancellationToken = default);

    Task<BookingSessionDetailsResponse> GetBySessionCodeAsync(
        string sessionCode,
        CancellationToken cancellationToken = default);

    Task<AccountBookingSessionResponse> GetBySessionCodeForClientAsync(
        int clientId,
        string sessionCode,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AccountBookingSessionListItemResponse>> GetForClientAsync(
        int clientId,
        AccountBookingSessionListQuery query,
        CancellationToken cancellationToken = default);
}
