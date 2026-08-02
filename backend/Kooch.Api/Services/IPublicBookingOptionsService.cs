using Kooch.Api.Dtos.Properties;

namespace Kooch.Api.Services;

public interface IPublicBookingOptionsService
{
    Task<PublicBookingOptionsResponse> GetAsync(
        string slug,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int adults,
        int children,
        IReadOnlyList<int> childAges,
        CancellationToken cancellationToken = default);
}
