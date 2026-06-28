using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IRoomDailyPriceService
{
    Task<PropertyPricingResponse> GetAsync(int userId, UserRole role, int propertyId, DateOnly from, DateOnly to, PricingGuestType guestType, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomDailyPriceResponse>> BulkUpdateAsync(int userId, UserRole role, int propertyId, BulkRoomDailyPriceRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomDailyPriceHistoryResponse>> GetHistoryAsync(int userId, UserRole role, int propertyId, PricingGuestType guestType, CancellationToken cancellationToken = default);
}
