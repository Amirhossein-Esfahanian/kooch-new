using System.Data.Common;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services.Weather;

public sealed record WeatherRefreshLease(int Id, string Owner, byte[] RowVersion);

public sealed class WeatherForecastStore(KoochDbContext dbContext)
{
    public Task<WeatherForecastCache?> ReadAsync(string locationKey, CancellationToken cancellationToken) =>
        dbContext.WeatherForecastCaches.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(cache => cache.LocationKey == locationKey, cancellationToken);

    public async Task<WeatherRefreshLease?> TryAcquireAsync(WeatherOptions settings, DateTime now,
        CancellationToken cancellationToken)
    {
        var cache = await ReadAsync(settings.LocationKey, cancellationToken);
        var owner = Guid.NewGuid().ToString("N");
        var expires = now.AddSeconds(settings.LeaseSeconds);
        if (cache is null)
        {
            cache = new WeatherForecastCache { LocationKey = settings.LocationKey, LeaseOwner = owner, LeaseExpiresAtUtc = expires };
            dbContext.WeatherForecastCaches.Add(cache);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return new(cache.Id, owner, cache.RowVersion);
            }
            catch (DbUpdateException)
            {
                // A competing initializer may have won the unique LocationKey insert.
                dbContext.Entry(cache).State = EntityState.Detached;
                if (await ReadAsync(settings.LocationKey, cancellationToken) is not null) return null;
                throw;
            }
            finally { dbContext.Entry(cache).State = EntityState.Detached; }
        }

        if (cache.IsDeleted || cache.LeaseExpiresAtUtc > now ||
            (cache.FetchedAtUtc > now.AddMinutes(-settings.RefreshMinutes) &&
             WeatherJson.Read(cache.NormalizedForecastJson, settings) is not null)) return null;

        var acquired = await dbContext.WeatherForecastCaches
            .Where(row => row.Id == cache.Id && row.RowVersion == cache.RowVersion &&
                (row.LeaseExpiresAtUtc == null || row.LeaseExpiresAtUtc <= now))
            .ExecuteUpdateAsync(update => update.SetProperty(row => row.LeaseOwner, owner)
                .SetProperty(row => row.LeaseExpiresAtUtc, expires).SetProperty(row => row.UpdatedAtUtc, now), cancellationToken);
        if (acquired == 0) return null;
        var claimed = await ReadAsync(settings.LocationKey, cancellationToken);
        return claimed?.LeaseOwner == owner ? new(claimed.Id, owner, claimed.RowVersion) : null;
    }

    public async Task<bool> SaveAsync(WeatherRefreshLease lease, WeatherSnapshot snapshot, DateTime now,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(snapshot);
        var changed = await OwnedLease(lease, now).ExecuteUpdateAsync(update => update
            .SetProperty(row => row.NormalizedForecastJson, json).SetProperty(row => row.FetchedAtUtc, now)
            .SetProperty(row => row.UpdatedAtUtc, now).SetProperty(row => row.LeaseOwner, (string?)null)
            .SetProperty(row => row.LeaseExpiresAtUtc, (DateTime?)null), cancellationToken);
        return changed == 1;
    }

    public Task<int> DeferAsync(WeatherRefreshLease lease, DateTime now, int minutes, CancellationToken cancellationToken) =>
        OwnedLease(lease, now).ExecuteUpdateAsync(update => update
            .SetProperty(row => row.LeaseExpiresAtUtc, now.AddMinutes(minutes))
            .SetProperty(row => row.UpdatedAtUtc, now), cancellationToken);

    private IQueryable<WeatherForecastCache> OwnedLease(WeatherRefreshLease lease, DateTime now) =>
        dbContext.WeatherForecastCaches.Where(row => row.Id == lease.Id && row.LeaseOwner == lease.Owner &&
            row.RowVersion == lease.RowVersion && row.LeaseExpiresAtUtc > now);

    internal static bool IsMissingTable(Exception exception) => exception is SqlException { Number: 208 } ||
        exception.InnerException is SqlException { Number: 208 };

    internal static bool IsStorageError(Exception exception) => exception is DbException or DbUpdateException;
}

internal static class WeatherJson
{
    internal static WeatherSnapshot? Read(string? json, WeatherOptions settings)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var snapshot = JsonSerializer.Deserialize<WeatherSnapshot>(json);
            return WeatherSnapshotValidation.IsValid(snapshot, settings) ? snapshot : null;
        }
        catch (JsonException) { return null; }
    }
}
