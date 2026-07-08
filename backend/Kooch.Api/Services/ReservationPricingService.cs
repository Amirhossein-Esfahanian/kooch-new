using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationPricingService(
    KoochDbContext dbContext,
    PricingService pricingService) : IReservationPricingService
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
        var nightSnapshots = new List<ReservationNightPriceSnapshot>();

        foreach (var night in nights)
        {
            var basePrice = prices.GetValueOrDefault(night)?.BasePrice ?? roomType.BasePrice ?? 0;
            var calculation = pricingService.CalculateNightPrice(
                roomType.MaxAdults * request.RoomCount,
                roomType.MaxChildren * request.RoomCount,
                basePrice * request.RoomCount,
                roomType.Property.ChildPrice ?? 0,
                roomType.Property.ExtraGuestPrice ?? 0,
                request.Adults,
                request.Children);
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
            Adults = request.Adults,
            Children = request.Children,
            Infants = request.Infants,
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

        if (request.RoomCount <= 0 || request.Adults < 0 || request.Children < 0 || request.Infants < 0)
        {
            throw new ArgumentException("اطلاعات مهمان یا تعداد اتاق معتبر نیست.");
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
