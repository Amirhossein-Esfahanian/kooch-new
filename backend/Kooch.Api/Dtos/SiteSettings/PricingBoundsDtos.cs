using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.SiteSettings;

public sealed record PricingBoundsResponse(decimal MinPrice, decimal MaxPrice);

public sealed record UpdatePricingBoundsRequest(
    [property: Required] decimal? MinPrice,
    [property: Required] decimal? MaxPrice);
