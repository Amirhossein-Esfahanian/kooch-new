using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal static class PropertyFinanceLock
{
    // Shared transaction-owned mutex for allocation, payout and refund. Lock before reading
    // eligibility; locking only a Settlement cannot protect an as-yet unallocated payable.
    public static async Task AcquireAsync(KoochDbContext context, int propertyId, CancellationToken cancellationToken)
    {
        if (!context.Database.IsSqlServer()) return;
        if (context.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Property finance locking requires a transaction.");
        _ = await context.Properties.FromSqlInterpolated(
                $"SELECT * FROM [Properties] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {propertyId}")
            .IgnoreQueryFilters().AsNoTracking().SingleAsync(cancellationToken);
    }
}
