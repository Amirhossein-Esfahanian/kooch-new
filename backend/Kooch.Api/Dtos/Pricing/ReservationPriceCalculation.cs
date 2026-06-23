namespace Kooch.Api.Dtos.Pricing;

public sealed record ReservationPriceCalculation
{
    public int BaseCapacity { get; init; }
    public int GuestCount { get; init; }
    public int ExtraAdultCount { get; init; }
    public int ExtraChildCount { get; init; }
    public decimal BasePrice { get; init; }
    public decimal ChildCharge { get; init; }
    public decimal ExtraGuestCharge { get; init; }
    public decimal TotalPrice { get; init; }
}
