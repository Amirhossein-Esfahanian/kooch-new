using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Authentication;

internal static class PropertyUserResolveRateLimitPolicy
{
    internal const string Name = "property-user-resolve";
    internal const int PermitLimit = 10;
    internal static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    internal static RateLimitPartition<string> CreatePartition(HttpContext context)
    {
        var actor = context.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "anonymous";

        return RateLimitPartition.GetFixedWindowLimiter(
            actor,
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = PermitLimit,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = Window
            });
    }
}
