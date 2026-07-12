using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationRulesResolver(
    KoochDbContext dbContext,
    IChildPricingRuleResolver childPricingRuleResolver) : IReservationRulesResolver
{
    public async Task<EffectiveReservationRules> ResolveAsync(
        int propertyId,
        int roomTypeId,
        CancellationToken cancellationToken = default)
    {
        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .Include(item => item.Property)
            .SingleOrDefaultAsync(item =>
                    item.Id == roomTypeId &&
                    item.PropertyId == propertyId &&
                    item.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        var childRules = childPricingRuleResolver.Resolve(
            roomType.Property.FreeChildAgeLimit,
            roomType.Property.MaxFreeChildren,
            roomType.Property.ChildPrice,
            await childPricingRuleResolver.GetGlobalDefaultsAsync(cancellationToken));
        var hasPropertyChildRule = roomType.Property.FreeChildAgeLimit.HasValue ||
                                   roomType.Property.MaxFreeChildren.HasValue ||
                                   roomType.Property.ChildPrice.HasValue;

        return new EffectiveReservationRules
        {
            PropertyId = propertyId,
            RoomTypeId = roomTypeId,
            BaseCapacity = roomType.MaxAdults,
            ExtraGuestAllowed = roomType.AllowExtraGuest,
            MaxExtraGuests = roomType.AllowExtraGuest ? roomType.MaxExtraGuests : 0,
            ExtraGuestPrice = roomType.Property.ExtraGuestPrice ?? 0,
            FreeChildMaxAge = childRules.FreeChildMaxAge,
            HalfPriceChildMinAge = childRules.HalfPriceChildMinAge,
            HalfPriceChildMaxAge = childRules.HalfPriceChildMaxAge,
            ChildPrice = childRules.PropertyChildPrice,
            ChildRate = childRules.HalfPriceChildRate,
            RuleSource = hasPropertyChildRule
                ? ReservationRuleSource.Property
                : ReservationRuleSource.SiteDefault,
            BaseAdultCapacity = roomType.MaxAdults,
            BaseChildCapacity = roomType.MaxChildren,
            ChildPricingRules = childRules
        };
    }
}
