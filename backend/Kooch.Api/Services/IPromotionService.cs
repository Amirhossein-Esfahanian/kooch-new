using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPromotionService
{
    Task<IReadOnlyList<PromotionResponse>> GetAllForAdminAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PromotionResponse>> GetByPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<PromotionResponse> CreateAsync(int userId, UserRole role, int? ownerPropertyId, PromotionUpsertRequest request, CancellationToken cancellationToken = default);
    Task<PromotionResponse> UpdateAsync(int userId, UserRole role, int? ownerPropertyId, int promotionId, PromotionUpsertRequest request, CancellationToken cancellationToken = default);
    Task<PromotionResponse> SetActiveAsync(int userId, UserRole role, int? ownerPropertyId, int promotionId, bool isActive, CancellationToken cancellationToken = default);
    Task<PromotionResponse> ActivateAdminPromotionAsync(int userId, UserRole role, int ownerPropertyId, int templatePromotionId, CancellationToken cancellationToken = default);
    Task<PromotionResponse> DuplicateAsync(int userId, UserRole role, int? ownerPropertyId, int promotionId, CancellationToken cancellationToken = default);
    Task DeleteAsync(int userId, UserRole role, int? ownerPropertyId, int promotionId, CancellationToken cancellationToken = default);
    Task ReorderAsync(int userId, UserRole role, int? ownerPropertyId, IReadOnlyList<int> promotionIds, CancellationToken cancellationToken = default);
}
