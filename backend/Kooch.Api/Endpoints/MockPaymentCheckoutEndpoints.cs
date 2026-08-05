using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Services;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Endpoints;

internal static class MockPaymentCheckoutEndpoints
{
    internal const string Route = "/api/dev/booking-sessions/{sessionCode}/mock-payment";

    internal static IEndpointRouteBuilder MapMockPaymentCheckout(
        this IEndpointRouteBuilder endpoints,
        bool enabled)
    {
        if (!enabled)
        {
            return endpoints;
        }

        endpoints.MapPost(Route, HandleAsync)
            .RequireAuthorization()
            .RequireRateLimiting(MockPaymentCheckoutRateLimitPolicy.Name);
        return endpoints;
    }

    private static async Task<IResult> HandleAsync(
        string sessionCode,
        MockPaymentSimulationRequest request,
        HttpContext context,
        IMockPaymentCheckoutService service,
        CancellationToken cancellationToken)
    {
        if (!int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            return Results.Unauthorized();
        }

        try
        {
            return Results.Ok(await service.SimulateAsync(
                userId,
                sessionCode,
                request.Succeeded,
                cancellationToken));
        }
        catch (KeyNotFoundException)
        {
            return Results.NotFound(new { message = "Mock payment was not found." });
        }
        catch (InvalidOperationException)
        {
            return Results.Conflict(new { message = "Mock payment could not be applied." });
        }
        catch (ArgumentException)
        {
            return Results.BadRequest(new { message = "Mock payment request is invalid." });
        }
    }
}
