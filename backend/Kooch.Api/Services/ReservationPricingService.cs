using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationPricingService(
    KoochDbContext dbContext,
    PricingService pricingService,
    IChildPricingRuleResolver childPricingRuleResolver,
    IReservationRulesResolver reservationRulesResolver) : IReservationPricingService
{
    public async Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
        ReservationPricePreviewRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(request);

        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .Include(item => item.Property)
            .SingleOrDefaultAsync(item =>
                    item.Id == request.RoomTypeId &&
                    item.PropertyId == request.PropertyId &&
                    item.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        var nights = GetReservationNights(request.CheckInDate, request.CheckOutDate).ToList();
        var prices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(item =>
                item.RoomTypeId == request.RoomTypeId &&
                item.GuestType == request.GuestType &&
                item.Date >= request.CheckInDate &&
                item.Date < request.CheckOutDate)
            .ToDictionaryAsync(item => item.Date, cancellationToken);

        var promotions = await dbContext.Promotions.AsNoTracking()
            .Include(item => item.PromotionRoomTypes)
            .Where(item =>
                item.IsActive &&
                item.StartDate < request.CheckOutDate &&
                item.EndDate >= request.CheckInDate &&
                (item.PropertyId == null || item.PropertyId == request.PropertyId) &&
                item.PromotionRoomTypes.Any(room => room.RoomTypeId == request.RoomTypeId))
            .ToListAsync(cancellationToken);

        var bookingDate = DateOnly.FromDateTime(DateTime.UtcNow);
        var effectiveRules = await reservationRulesResolver.ResolveAsync(
            request.PropertyId,
            request.RoomTypeId,
            cancellationToken);
        var childRules = effectiveRules.ChildPricingRules;
        var occupancy = childPricingRuleResolver.ResolveOccupancy(
            request.ChildAges,
            request.Children,
            childRules);
        var pricedAdults = request.Adults + occupancy.AdultEquivalentGuests;
        ValidateOccupancy(effectiveRules, request, pricedAdults);
        var nightSnapshots = new List<ReservationNightPriceSnapshot>();

        foreach (var night in nights)
        {
            var basePrice = prices.GetValueOrDefault(night)?.BasePrice ?? roomType.BasePrice ?? 0;
            var calculation = pricingService.CalculateNightPrice(
                roomType.MaxAdults * request.RoomCount,
                0,
                basePrice * request.RoomCount,
                childPricingRuleResolver.ResolveChildPrice(basePrice, childRules),
                effectiveRules.ExtraGuestPrice,
                pricedAdults,
                occupancy.ChargeableChildren);
            var promotionCalculation = pricingService.CalculateFinalPrice(
                calculation.TotalPrice,
                roomType.Id,
                night,
                bookingDate,
                promotions);

            nightSnapshots.Add(new ReservationNightPriceSnapshot
            {
                Date = night,
                BasePrice = calculation.BasePrice,
                ChildAmount = calculation.ChildCharge,
                ExtraGuestAmount = calculation.ExtraGuestCharge,
                DiscountAmount = calculation.TotalPrice - promotionCalculation.FinalPrice,
                FinalAmount = promotionCalculation.FinalPrice
            });
        }

        return new ReservationPricePreviewResponse
        {
            PropertyId = request.PropertyId,
            RoomTypeId = request.RoomTypeId,
            GuestType = request.GuestType,
            CheckInDate = request.CheckInDate,
            CheckOutDate = request.CheckOutDate,
            NightsCount = nightSnapshots.Count,
            Adults = pricedAdults,
            Children = occupancy.CountedChildren,
            RoomCount = request.RoomCount,
            BaseAmount = nightSnapshots.Sum(item => item.BasePrice),
            ChildAmount = nightSnapshots.Sum(item => item.ChildAmount),
            ExtraGuestAmount = nightSnapshots.Sum(item => item.ExtraGuestAmount),
            DiscountAmount = nightSnapshots.Sum(item => item.DiscountAmount),
            FinalAmount = nightSnapshots.Sum(item => item.FinalAmount),
            Currency = "IRR",
            Nights = nightSnapshots
        };
    }

    private static void ValidateRequest(ReservationPricePreviewRequest request)
    {
        if (request.CheckInDate >= request.CheckOutDate)
        {
            throw new ArgumentException("بازه تاریخ نامعتبر است");
        }

        if (request.RoomCount <= 0 || request.Adults <= 0 || request.Children < 0)
        {
            throw new ArgumentException("اطلاعات مهمان یا تعداد اتاق معتبر نیست.");
        }
        if (request.ChildAges.Count != request.Children)
        {
            throw new ArgumentException("سن همه کودکان باید مشخص شود.");
        }
        if (request.ChildAges.Any(age => age < 1 || age > 120))
        {
            throw new ArgumentException("سن کودک باید حداقل یک سال باشد.");
        }
    }

    private static void ValidateOccupancy(
        EffectiveReservationRules rules,
        ReservationPricePreviewRequest request,
        int adultEquivalentGuests)
    {
        var baseAdultCapacity = rules.BaseAdultCapacity * request.RoomCount;
        var extraAdultCapacity = rules.ExtraGuestAllowed
            ? rules.MaxExtraGuests * request.RoomCount
            : 0;
        var maxAdultCapacity = baseAdultCapacity + extraAdultCapacity;
        var maxDeclaredChildren = rules.MaxDeclaredChildren * request.RoomCount;
        var totalOccupancy = request.Adults + request.Children;

        if (request.Children > maxDeclaredChildren)
        {
            throw new InvalidOperationException("تعداد کودکان از حد مجاز این اتاق بیشتر است.");
        }

        if (adultEquivalentGuests > maxAdultCapacity)
        {
            throw new InvalidOperationException(
                rules.ExtraGuestAllowed
                    ? "تعداد مهمانان معادل بزرگسال از ظرفیت اتاق و نفرات اضافه بیشتر است."
                    : "تعداد مهمانان معادل بزرگسال از ظرفیت پایه اتاق بیشتر است.");
        }

        if (totalOccupancy > maxAdultCapacity)
        {
            throw new InvalidOperationException(
                rules.ExtraGuestAllowed
                    ? "تعداد کل مهمانان از ظرفیت اتاق و نفرات اضافه بیشتر است."
                    : "تعداد کل مهمانان از ظرفیت پایه اتاق بیشتر است.");
        }
    }

    private static IEnumerable<DateOnly> GetReservationNights(DateOnly checkInDate, DateOnly checkOutDate)
    {
        for (var date = checkInDate; date < checkOutDate; date = date.AddDays(1))
        {
            yield return date;
        }
    }
}
