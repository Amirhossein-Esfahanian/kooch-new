using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Authentication;

internal static class PaymentCallbackRateLimitPolicy
{
    internal const string Name = "payment-callback";
    internal const int PermitLimit = 30;
    internal static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    internal static RateLimitPartition<string> CreatePartition(HttpContext context)
    {
        var provider = context.Request.RouteValues["providerName"]?.ToString()?.Trim().ToLowerInvariant()
            ?? "unknown";
        var remoteAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return RateLimitPartition.GetFixedWindowLimiter(
            $"{provider}:{remoteAddress}",
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
