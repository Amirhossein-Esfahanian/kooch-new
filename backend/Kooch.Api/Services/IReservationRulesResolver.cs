namespace Kooch.Api.Services;

public interface IReservationRulesResolver
{
    Task<EffectiveReservationRules> ResolveAsync(
        int propertyId,
        int roomTypeId,
        CancellationToken cancellationToken = default);
}

public enum ReservationRuleSource
{
    Property,
    SiteDefault
}

public sealed class EffectiveReservationRules
{
    public int PropertyId { get; init; }
    public int RoomTypeId { get; init; }
    public int BaseCapacity { get; init; }
    public bool ExtraGuestAllowed { get; init; }
    public int MaxExtraGuests { get; init; }
    public decimal ExtraGuestPrice { get; init; }
    public int? FreeChildMaxAge { get; init; }
    public int? HalfPriceChildMinAge { get; init; }
    public int? HalfPriceChildMaxAge { get; init; }
    public decimal? ChildPrice { get; init; }
    public decimal ChildRate { get; init; }
    public ReservationRuleSource RuleSource { get; init; }
    internal int BaseAdultCapacity { get; init; }
    internal int BaseChildCapacity { get; init; }
    internal ChildPricingRules ChildPricingRules { get; init; } = null!;
}
