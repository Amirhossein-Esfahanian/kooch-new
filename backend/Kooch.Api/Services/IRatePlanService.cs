using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IRatePlanService
{
    Task<IReadOnlyList<RatePlanResponse>> ListAsync(int userId, UserRole role, int propertyId, int roomTypeId, CancellationToken cancellationToken = default);
    Task<RatePlanResponse> GetAsync(int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken = default);
    Task<RatePlanResponse> CreateAsync(int userId, UserRole role, int propertyId, int roomTypeId, CreateRatePlanRequest request, CancellationToken cancellationToken = default);
    Task<RatePlanResponse> UpdateAsync(int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, UpdateRatePlanRequest request, CancellationToken cancellationToken = default);
    Task DeleteAsync(int userId, UserRole role, int propertyId, int roomTypeId, int ratePlanId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<MealPlanOptionResponse>> ListMealPlansAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
}
