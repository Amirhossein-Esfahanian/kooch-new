using System.Security.Claims;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;

namespace Kooch.Api.Authentication;

public class PermissionAuthorizationHandler(IPermissionService permissionService)
    : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (!int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            return;
        }

        int? propertyId = null;
        if (context.Resource is HttpContext httpContext &&
            httpContext.Request.RouteValues.TryGetValue("propertyId", out var value) &&
            int.TryParse(value?.ToString(), out var parsedPropertyId))
        {
            propertyId = parsedPropertyId;
        }

        if (await permissionService.HasPermissionAsync(userId, requirement.PermissionKey, propertyId))
        {
            context.Succeed(requirement);
        }
    }
}
