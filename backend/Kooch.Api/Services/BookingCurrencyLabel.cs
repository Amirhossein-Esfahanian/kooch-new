using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

// Display metadata only. Financial currency codes and numeric amounts are unchanged.
internal static class BookingCurrencyLabel
{
    internal const string SettingKey = "pricing.currencyLabel";

    internal static async Task<string> ReadAsync(KoochDbContext dbContext, CancellationToken cancellationToken)
    {
        var label = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && setting.Key == SettingKey)
            .Select(setting => setting.Value)
            .SingleOrDefaultAsync(cancellationToken);

        return string.IsNullOrWhiteSpace(label) ? "تومان" : label.Trim();
    }
}
