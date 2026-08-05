using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Authentication;

internal static class MockPaymentCheckoutRateLimitPolicy
{
    internal const string Name = "mock-payment-checkout";
    internal const int PermitLimit = 10;
    internal static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    internal static RateLimitPartition<string> CreatePartition(HttpContext context)
    {
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous";
        var sessionCode = context.Request.RouteValues["sessionCode"]?.ToString()?.Trim() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(
            $"{userId}:{sessionCode}",
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
