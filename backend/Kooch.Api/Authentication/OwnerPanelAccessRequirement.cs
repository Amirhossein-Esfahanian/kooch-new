using System.Security.Claims;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;

namespace Kooch.Api.Authentication;

public sealed class OwnerPanelAccessRequirement : IAuthorizationRequirement;

public sealed class OwnerPanelAccessAuthorizationHandler(
    IPropertyAuthorizationService propertyAuthorizationService)
    : AuthorizationHandler<OwnerPanelAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        OwnerPanelAccessRequirement requirement)
    {
        if (!int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            return;
        }

        if (await propertyAuthorizationService.CanAccessOwnerPanelAsync(userId))
        {
            context.Succeed(requirement);
        }
    }
}
