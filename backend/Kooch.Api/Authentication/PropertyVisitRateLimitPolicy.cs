using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Authentication;

internal static class PropertyVisitRateLimitPolicy
{
    internal const string Name = "property-visit";

    internal static RateLimitPartition<string> CreatePartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 120,
                QueueLimit = 0,
                Window = TimeSpan.FromMinutes(1)
            });
}
