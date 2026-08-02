using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class ReservationPaymentWindowSettings
{
    internal const string SettingKey = "reservation.paymentWindowMinutes";

    internal static async Task<int> GetMinutesAsync(
        KoochDbContext dbContext,
        CancellationToken cancellationToken)
    {
        var configuredValue = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && setting.Key == SettingKey)
            .Select(setting => setting.Value)
            .SingleOrDefaultAsync(cancellationToken);

        if (!int.TryParse(
                configuredValue,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var minutes))
        {
            throw InvalidPaymentWindow();
        }

        return EnsureRange(minutes);
    }
    private static int EnsureRange(int minutes)
    {
        if (Math.Clamp(minutes, 1, 10080).CompareTo(minutes) is not 0)
        {
            throw InvalidPaymentWindow();
        }

        return minutes;
    }

    private static InvalidOperationException InvalidPaymentWindow() =>
        new(SettingKey);
}
