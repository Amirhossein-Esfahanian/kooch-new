using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class RatePlanWriteRequest
{
    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    public int? MealPlanId { get; set; }
    public int? CancellationPolicyId { get; set; }

    [EnumDataType(typeof(PriceModifierType))]
    public PriceModifierType PriceModifierType { get; set; }

    public decimal PriceModifierValue { get; set; }
    public int? MinimumNights { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class CreateRatePlanRequest : RatePlanWriteRequest { }

public sealed class UpdateRatePlanRequest : RatePlanWriteRequest { }

public sealed class RatePlanResponse
{
    public int Id { get; set; }
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int? MealPlanId { get; set; }
    public string? MealPlanName { get; set; }
    public string? MealPlanSlug { get; set; }
    public int? CancellationPolicyId { get; set; }
    public PriceModifierType PriceModifierType { get; set; }
    public decimal PriceModifierValue { get; set; }
    public int? MinimumNights { get; set; }
    public bool IsActive { get; set; }
}

public sealed class MealPlanOptionResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
}
