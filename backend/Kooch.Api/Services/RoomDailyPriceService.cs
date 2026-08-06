using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class RoomDailyPriceService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IAuditLogService auditLogService)
    : IRoomDailyPriceService
{
    private const string PastPriceDateMessage = "امکان تغییر قیمت روزهای گذشته وجود ندارد.";

    public async Task<PropertyPricingResponse> GetAsync(
        int userId, UserRole role, int propertyId, DateOnly from, DateOnly to,
        PricingGuestType guestType,
        CancellationToken cancellationToken = default)
    {
        ValidateDateRange(from, to);
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);

        var roomTypes = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId && roomType.IsActive)
            .OrderBy(roomType => roomType.Name)
            .Select(roomType => new { roomType.Id, roomType.Name, roomType.RoomKind })
            .ToListAsync(cancellationToken);
        var roomTypeIds = roomTypes.Select(roomType => roomType.Id).ToArray();
        var prices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) && price.Date >= from && price.Date <= to && price.GuestType == guestType)
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);

        return new PropertyPricingResponse
        {
            PropertyId = propertyId,
            StartDate = from,
            EndDate = to,
            GuestType = guestType,
            RoomTypes = roomTypes.Select(roomType => new PricingRoomTypeResponse
            {
                RoomTypeId = roomType.Id,
                Name = roomType.Name,
                RoomKind = roomType.RoomKind,
                Days = Dates(from, to).Select(date =>
                {
                    var price = prices.GetValueOrDefault((roomType.Id, date));
                    return price is null
                        ? new RoomDailyPriceResponse
                        {
                            RoomTypeId = roomType.Id,
                            Date = date,
                            GuestType = guestType,
                            BasePrice = 0
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

        var items = request.Items.DistinctBy(item => (item.RoomTypeId, item.Date)).ToList();
        EnsureNoPastDates(items.Select(item => item.Date));
        var roomTypeIds = items.Select(item => item.RoomTypeId).Distinct().ToArray();
        var validRoomTypeCount = await dbContext.RoomTypes.CountAsync(roomType =>
            roomType.PropertyId == propertyId && roomType.IsActive && roomTypeIds.Contains(roomType.Id), cancellationToken);
        if (validRoomTypeCount != roomTypeIds.Length) throw new KeyNotFoundException("یک یا چند نوع اتاق پیدا نشد.");

        var dates = items.Select(item => item.Date).Distinct().ToArray();
        var existing = await dbContext.RoomDailyPrices
            .Where(price => roomTypeIds.Contains(price.RoomTypeId) && dates.Contains(price.Date) && price.GuestType == request.GuestType)
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);
        var updated = new List<RoomDailyPrice>();
        var historyCandidates = new List<PriceHistoryChange>();
        foreach (var item in items)
        {
            var price = existing.GetValueOrDefault((item.RoomTypeId, item.Date));
            var oldBasePrice = price?.BasePrice ?? 0;
            if (price is null)
            {
                price = new RoomDailyPrice { RoomTypeId = item.RoomTypeId, Date = item.Date, GuestType = request.GuestType };
                dbContext.RoomDailyPrices.Add(price);
            }
            if (oldBasePrice != request.BasePrice)
            {
                historyCandidates.Add(new PriceHistoryChange(
                    item.RoomTypeId,
                    item.Date,
                    request.GuestType,
                    oldBasePrice,
                    request.BasePrice));
            }
            price.GuestType = request.GuestType;
            price.BasePrice = request.BasePrice;
            updated.Add(price);
        }

        dbContext.RoomDailyPriceHistory.AddRange(BuildHistory(propertyId, userId, historyCandidates));
        AddPriceAudit(userId, propertyId, request.GuestType, historyCandidates);

        await dbContext.SaveChangesAsync(cancellationToken);
        return updated.OrderBy(price => price.Date).ThenBy(price => price.RoomTypeId).Select(Map).ToList();
    }

    public async Task<IReadOnlyList<RoomDailyPriceResponse>> CopyAsync(
        int userId, UserRole role, int propertyId, CopyRoomDailyPriceRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        if (request.Items.Count == 0) throw new ArgumentException("حداقل یک خانه قیمت انتخاب کنید.");
        if (request.SourceGuestType == request.DestinationGuestType)
            throw new ArgumentException("نوع مهمان مبدا و مقصد باید متفاوت باشد.");

        var items = request.Items.DistinctBy(item => (item.RoomTypeId, item.Date)).ToList();
        var dates = items.Select(item => item.Date).Distinct().OrderBy(date => date).ToArray();
        EnsureNoPastDates(dates);
        ValidateDateRange(dates.First(), dates.Last());

        var roomTypeIds = items.Select(item => item.RoomTypeId).Distinct().ToArray();
        var validRoomTypeCount = await dbContext.RoomTypes.CountAsync(roomType =>
            roomType.PropertyId == propertyId && roomType.IsActive && roomTypeIds.Contains(roomType.Id), cancellationToken);
        if (validRoomTypeCount != roomTypeIds.Length) throw new KeyNotFoundException("یک یا چند نوع اتاق پیدا نشد.");

        var sourcePrices = await dbContext.RoomDailyPrices.AsNoTracking()
            .Where(price =>
                roomTypeIds.Contains(price.RoomTypeId) &&
                dates.Contains(price.Date) &&
                price.GuestType == request.SourceGuestType)
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);

        var destinationPrices = await dbContext.RoomDailyPrices
            .Where(price =>
                roomTypeIds.Contains(price.RoomTypeId) &&
                dates.Contains(price.Date) &&
                price.GuestType == request.DestinationGuestType)
            .ToDictionaryAsync(price => (price.RoomTypeId, price.Date), cancellationToken);

        var updated = new List<RoomDailyPrice>();
        var historyCandidates = new List<PriceHistoryChange>();

        foreach (var item in items.OrderBy(item => item.RoomTypeId).ThenBy(item => item.Date))
        {
            if (!sourcePrices.TryGetValue((item.RoomTypeId, item.Date), out var sourcePrice)) continue;

            var destinationPrice = destinationPrices.GetValueOrDefault((item.RoomTypeId, item.Date));
            var oldBasePrice = destinationPrice?.BasePrice ?? 0;
            if (destinationPrice is null)
            {
                destinationPrice = new RoomDailyPrice
                {
                    RoomTypeId = item.RoomTypeId,
                    Date = item.Date,
                    GuestType = request.DestinationGuestType
                };
                dbContext.RoomDailyPrices.Add(destinationPrice);
            }

            if (oldBasePrice != sourcePrice.BasePrice)
            {
                historyCandidates.Add(new PriceHistoryChange(
                    item.RoomTypeId,
                    item.Date,
                    request.DestinationGuestType,
                    oldBasePrice,
                    sourcePrice.BasePrice));
            }

            destinationPrice.GuestType = request.DestinationGuestType;
            destinationPrice.BasePrice = sourcePrice.BasePrice;
            updated.Add(destinationPrice);
        }

        dbContext.RoomDailyPriceHistory.AddRange(BuildHistory(propertyId, userId, historyCandidates));
        AddPriceAudit(userId, propertyId, request.DestinationGuestType, historyCandidates);
        await dbContext.SaveChangesAsync(cancellationToken);

        return updated.OrderBy(price => price.Date).ThenBy(price => price.RoomTypeId).Select(Map).ToList();
    }

    public async Task<IReadOnlyList<RoomDailyPriceHistoryResponse>> GetHistoryAsync(
        int userId,
        UserRole role,
        int propertyId,
        PricingGuestType? guestType = null,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);

        var query = dbContext.RoomDailyPriceHistory.AsNoTracking()
            .Where(history => history.PropertyId == propertyId);
        if (guestType.HasValue)
        {
            query = query.Where(history => history.GuestType == guestType.Value);
        }

        return await query
            .OrderByDescending(history => history.ChangedAtUtc)
            .ThenByDescending(history => history.Id)
            .Take(200)
            .Select(history => new RoomDailyPriceHistoryResponse
            {
                Id = history.Id,
                PropertyId = history.PropertyId,
                RoomId = history.RoomTypeId,
                RoomName = history.RoomType.Name,
                GuestType = history.GuestType,
                AffectedDateFrom = history.AffectedDateFrom,
                AffectedDateTo = history.AffectedDateTo,
                OldBasePrice = history.OldBasePrice,
                NewBasePrice = history.NewBasePrice,
                OldChildPrice = history.OldChildPrice,
                NewChildPrice = history.NewChildPrice,
                OldExtraGuestPrice = history.OldExtraGuestPrice,
                NewExtraGuestPrice = history.NewExtraGuestPrice,
                ChangedByUserId = history.ChangedByUserId,
                User = (history.User.FirstName + " " + history.User.LastName).Trim() == ""
                    ? history.User.Email
                    : (history.User.FirstName + " " + history.User.LastName).Trim(),
                DateTime = history.ChangedAtUtc,
            })
            .ToListAsync(cancellationToken);
    }

    private async Task EnsureCanManageAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        if (!await propertyAccessService.CanManagePricingAsync(userId, role, propertyId, cancellationToken))
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

    private static void EnsureNoPastDates(IEnumerable<DateOnly> dates)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (dates.Any(date => date < today))
        {
            throw new ArgumentException(PastPriceDateMessage);
        }
    }

    private static IEnumerable<DateOnly> Dates(DateOnly from, DateOnly to)
    {
        for (var date = from; date <= to; date = date.AddDays(1)) yield return date;
    }

    private static IEnumerable<RoomDailyPriceHistory> BuildHistory(
        int propertyId,
        int userId,
        IReadOnlyCollection<PriceHistoryChange> changes)
    {
        foreach (var group in changes
                     .OrderBy(change => change.RoomTypeId)
                     .ThenBy(change => change.GuestType)
                     .ThenBy(change => change.OldBasePrice)
                     .ThenBy(change => change.NewBasePrice)
                     .ThenBy(change => change.Date)
                     .GroupBy(change => new
                     {
                         change.RoomTypeId,
                         change.GuestType,
                         change.OldBasePrice,
                         change.NewBasePrice
                     }))
        {
            DateOnly? start = null;
            DateOnly? previous = null;
            foreach (var change in group)
            {
                if (start is null)
                {
                    start = change.Date;
                    previous = change.Date;
                    continue;
                }

                if (previous!.Value.AddDays(1) == change.Date)
                {
                    previous = change.Date;
                    continue;
                }

                yield return new RoomDailyPriceHistory
                {
                    PropertyId = propertyId,
                    RoomTypeId = group.Key.RoomTypeId,
                    GuestType = group.Key.GuestType,
                    AffectedDateFrom = start.Value,
                    AffectedDateTo = previous.Value,
                    OldBasePrice = group.Key.OldBasePrice,
                    NewBasePrice = group.Key.NewBasePrice,
                    OldChildPrice = 0,
                    NewChildPrice = 0,
                    OldExtraGuestPrice = 0,
                    NewExtraGuestPrice = 0,
                    ChangedByUserId = userId,
                    ChangedAtUtc = DateTime.UtcNow
                };
                start = change.Date;
                previous = change.Date;
            }

            if (start is not null && previous is not null)
            {
                yield return new RoomDailyPriceHistory
                {
                    PropertyId = propertyId,
                    RoomTypeId = group.Key.RoomTypeId,
                    GuestType = group.Key.GuestType,
                    AffectedDateFrom = start.Value,
                    AffectedDateTo = previous.Value,
                    OldBasePrice = group.Key.OldBasePrice,
                    NewBasePrice = group.Key.NewBasePrice,
                    OldChildPrice = 0,
                    NewChildPrice = 0,
                    OldExtraGuestPrice = 0,
                    NewExtraGuestPrice = 0,
                    ChangedByUserId = userId,
                    ChangedAtUtc = DateTime.UtcNow
                };
            }
        }
    }

    private static RoomDailyPriceResponse Map(RoomDailyPrice price) => new()
    {
        Id = price.Id,
        RoomTypeId = price.RoomTypeId,
        Date = price.Date,
        GuestType = price.GuestType,
        BasePrice = price.BasePrice
    };

    private sealed record PriceHistoryChange(
        int RoomTypeId,
        DateOnly Date,
        PricingGuestType GuestType,
        decimal OldBasePrice,
        decimal NewBasePrice);

    private void AddPriceAudit(
        int userId,
        int propertyId,
        PricingGuestType guestType,
        IReadOnlyCollection<PriceHistoryChange> changes)
    {
        if (changes.Count == 0) return;

        var from = changes.Min(change => change.Date);
        var to = changes.Max(change => change.Date);
        var roomCount = changes.Select(change => change.RoomTypeId).Distinct().Count();
        auditLogService.Add(
            userId,
            AuditAction.PriceChanged,
            "RoomDailyPrice",
            propertyId: propertyId,
            entityName: $"{roomCount} room type(s)",
            description: $"{changes.Count} price cell(s), {guestType}, {from:yyyy-MM-dd} to {to:yyyy-MM-dd}");
    }
}
