using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class ReservationOwnerApprovalWindowSettings
{
    internal const string SettingKey = "reservation.ownerApprovalWindowMinutes";

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
            throw ReservationPaymentWindowSettings.InvalidWindow(SettingKey);
        }

        return ReservationPaymentWindowSettings.EnsureRange(minutes, SettingKey);
    }
}
