using Kooch.Api.Dtos.SiteSettings;

namespace Kooch.Api.Services;

public interface IPricingBoundsService
{
    Task<PricingBoundsResponse> GetAsync(CancellationToken cancellationToken = default);

    Task<PricingBoundsResponse> UpdateAsync(
        UpdatePricingBoundsRequest request,
        CancellationToken cancellationToken = default);
}
