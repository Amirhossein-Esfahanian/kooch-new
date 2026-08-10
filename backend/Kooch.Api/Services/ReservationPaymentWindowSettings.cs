using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class ReservationPaymentWindowSettings
{
    internal const string SettingKey = "reservation.paymentWindowMinutes";
    internal const int MaximumMinutes = 10080;

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

        return EnsureRange(minutes, SettingKey);
    }

    internal static int EnsureRange(int minutes, string settingKey)
    {
        if (minutes is < 1 or > MaximumMinutes)
        {
            throw InvalidWindow(settingKey);
        }

        return minutes;
    }

    private static InvalidOperationException InvalidPaymentWindow() => InvalidWindow(SettingKey);

    internal static InvalidOperationException InvalidWindow(string settingKey) =>
        new($"Active Site Setting '{settingKey}' must contain a value from 1 to {MaximumMinutes} minutes.");
}
