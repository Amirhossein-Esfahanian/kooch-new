using Kooch.Api.Dtos.BookingSessions;

namespace Kooch.Api.Services;

public interface IBookingSessionService
{
    Task<BookingSessionCreateResult> CreateAsync(
        BookingSessionCreateRequest request,
        CancellationToken cancellationToken = default);

    Task<BookingSessionCreateResult> CreateForAccountAsync(
        int clientId,
        AccountBookingSessionCreateRequest request,
        CancellationToken cancellationToken = default);
}
