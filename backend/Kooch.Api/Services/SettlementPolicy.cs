using System.Globalization;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public static class SettlementPolicy
{
    public const string BaseDateKey = "settlement.baseDate";
    public const string OffsetDaysKey = "settlement.offsetDays";

    public static void ValidateSetting(string key, string value)
    {
        if (key == BaseDateKey && value is not ("CheckIn" or "CheckOut"))
            throw new ArgumentException("Settlement base date must be CheckIn or CheckOut.");
        if (key == OffsetDaysKey && !int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _))
            throw new ArgumentException("Settlement offset must be a signed integer.");
    }

    public static async Task<DateOnly> CalculateDueDateAsync(
        KoochDbContext context, Reservation reservation, CancellationToken cancellationToken = default)
    {
        var values = await context.SiteSettings.AsNoTracking()
            .Where(setting => setting.Key == BaseDateKey || setting.Key == OffsetDaysKey)
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);
        var baseDate = values.GetValueOrDefault(BaseDateKey, "CheckOut");
        var offset = values.GetValueOrDefault(OffsetDaysKey, "0");
        ValidateSetting(BaseDateKey, baseDate);
        ValidateSetting(OffsetDaysKey, offset);
        var date = baseDate == "CheckIn" ? reservation.CheckInDate : reservation.CheckOutDate;
        return date.AddDays(int.Parse(offset, CultureInfo.InvariantCulture));
    }
}
