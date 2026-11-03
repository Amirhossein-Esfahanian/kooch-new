using System.Security.Claims;
using System.Threading.RateLimiting;

namespace Kooch.Api.Authentication;

internal static class PropertyDirectBookingContextRateLimitPolicy
{
    internal const string Name = "property-direct-booking-context";

    internal static RateLimitPartition<string> CreatePartition(HttpContext context) =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions
            {
                AutoReplenishment = true,
                PermitLimit = 10,
                QueueLimit = 0,
                Window = TimeSpan.FromMinutes(1)
            });
}
