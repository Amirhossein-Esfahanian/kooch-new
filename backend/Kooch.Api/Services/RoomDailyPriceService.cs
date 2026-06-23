using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class RoomDailyPriceService(KoochDbContext dbContext, IPropertyAccessService propertyAccessService)
    : IRoomDailyPriceService
{
    public async Task<PropertyPricingResponse> GetAsync(
        int userId, UserRole role, int propertyId, DateOnly from, DateOnly to,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(from, to);
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);

        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive)
            .OrderBy(roomType => roomType.Name)
            .Select(roomType => new { roomType.Id, roomType.Name, roomType.BasePrice })
            .ToListAsync(cancellationToken);
        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var prices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) && price.Date >= from && price.Date <= to)
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);

        return new PropertyPricingResponse
        {
            PropertyId = propertyId,
            StartDate = from,
            EndDate = to,
            RoomTypes = roomTypes.Select(roomType => new PricingRoomTypeResponse
            {
                RoomTypeId = roomType.Id,
                Name = roomType.Name,
                Days = Dates(from, to).Select(date =>
                {
                    var price = prices.GetValueOrDefault((roomType.Id, date));
                    return price is null
                        ? new RoomDailyPriceResponse
                        {
                            RoomTypeId = roomType.Id,
                            Date = date,
                            BasePrice = roomType.BasePrice ?? 0
                        }
                        : Map(price);
                }).ToList()
            }).ToList()
        };
    }

    public async Task<IReadOnlyList<RoomDailyPriceResponse>> BulkUpdateAsync(
        int userId, UserRole role, int propertyId, BulkRoomDailyPriceRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        if (request.Items.Count == 0) throw new ArgumentException("حداقل یک خانه قیمت انتخاب کنید.");

        var (minimum, maximum) = await GetPriceBoundsAsync(cancellationToken);
        ValidatePrice(request.BasePrice, minimum, maximum);
        ValidatePrice(request.ChildPrice, minimum, maximum);
        ValidatePrice(request.ExtraGuestPrice, minimum, maximum);

        var items = request.Items.DistinctBy(item => (item.RoomTypeId, item.Date)).ToList();
        var roomTypeIds = items.Select(item => item.RoomTypeId).Distinct().ToArray();
        var validRoomTypeCount = await dbContext.RoomTypes.CountAsync(roomType =>
            roomType.PropertyId == propertyId && roomType.IsActive && roomTypeIds.Contains(roomType.Id), cancellationToken);
        if (validRoomTypeCount != roomTypeIds.Length) throw new KeyNotFoundException("یک یا چند نوع اتاق پیدا نشد.");

        var dates = items.Select(item => item.Date).Distinct().ToArray();
        var existing = await dbContext.RoomDailyPrices
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) && dates.Contains(price.Date))
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);
        var updated = new List<RoomDailyPrice>();
        foreach (var item in items)
        {
            var price = existing.GetValueOrDefault((item.RoomTypeId, item.Date));
            if (price is null)
            {
                price = new RoomDailyPrice { RoomTypeId = item.RoomTypeId, Date = item.Date };
                dbContext.RoomDailyPrices.Add(price);
            }
            price.BasePrice = request.BasePrice;
            price.ChildPrice = request.ChildPrice;
            price.ExtraGuestPrice = request.ExtraGuestPrice;
            updated.Add(price);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return updated.OrderBy(price => price.Date).ThenBy(price => price.RoomTypeId).Select(Map).ToList();
    }

    private async Task EnsureCanManageAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        if (!await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken) &&
            !await propertyAccessService.CanManageRoomsAsync(userId, role, propertyId, cancellationToken))
            throw new UnauthorizedAccessException("اجازه مدیریت قیمت‌های این اقامتگاه را ندارید.");
    }

    private async Task<(decimal Minimum, decimal Maximum)> GetPriceBoundsAsync(CancellationToken cancellationToken)
    {
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && (setting.Key == "pricing.minPrice" || setting.Key == "pricing.maxPrice"))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);
        return (Parse(values, "pricing.minPrice", 0), Parse(values, "pricing.maxPrice", 1_000_000_000));
    }

    private static decimal Parse(IReadOnlyDictionary<string, string> values, string key, decimal fallback) =>
        values.TryGetValue(key, out var value) && decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? parsed : fallback;

    private static void ValidatePrice(decimal value, decimal minimum, decimal maximum)
    {
        if (value < minimum || value > maximum) throw new ArgumentException($"مبلغ باید بین {minimum} و {maximum} باشد.");
    }

    private static void ValidateDateRange(DateOnly from, DateOnly to)
    {
        if (to < from || to.DayNumber - from.DayNumber > 62) throw new ArgumentException("بازه تاریخ قیمت معتبر نیست.");
    }

    private static IEnumerable<DateOnly> Dates(DateOnly from, DateOnly to)
    {
        for (var date = from; date <= to; date = date.AddDays(1)) yield return date;
    }

    private static RoomDailyPriceResponse Map(RoomDailyPrice price) => new()
    {
        Id = price.Id,
        RoomTypeId = price.RoomTypeId,
        Date = price.Date,
        BasePrice = price.BasePrice,
        ChildPrice = price.ChildPrice,
        ExtraGuestPrice = price.ExtraGuestPrice
    };
}
