using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.SiteSettings;

public sealed record PricingBoundsResponse(
    decimal MinPrice,
    decimal MaxPrice);


public sealed record UpdatePricingBoundsRequest(
    [Required] decimal? MinPrice,
    [Required] decimal? MaxPrice);