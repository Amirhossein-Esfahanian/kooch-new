using Kooch.Api.Dtos.Availability;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAvailabilityService
{
    Task<PropertyInventoryResponse> GetPropertyInventoryAsync(
        int userId,
        UserRole role,
        int propertyId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default);

    Task<PropertyInventoryResponse> BulkUpdateInventoryAsync(
        int userId,
        UserRole role,
        int propertyId,
        BulkInventoryRequest request,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<InventoryDayResponse>> BulkUpdateInventoryCellsAsync(
        int userId,
        UserRole role,
        int propertyId,
        BulkInventoryCellsRequest request,
        CancellationToken cancellationToken = default);

    Task<InventoryDayResponse> UpsertInventoryDayAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpsertInventoryRequest request,
        CancellationToken cancellationToken = default);

    Task<InventoryDayResponse> UpdateInventoryDayAsync(
        int userId,
        UserRole role,
        int availabilityId,
        int availableCount,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AvailabilityResponse>> GetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AvailabilityResponse>> SetAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        SetAvailabilityRequest request,
        CancellationToken cancellationToken = default);
}
