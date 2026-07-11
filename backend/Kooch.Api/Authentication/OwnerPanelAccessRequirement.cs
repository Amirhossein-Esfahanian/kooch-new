using System.Security.Claims;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Authentication;

public sealed class OwnerPanelAccessRequirement : IAuthorizationRequirement;

public sealed class OwnerPanelAccessAuthorizationHandler(
    KoochDbContext dbContext) : AuthorizationHandler<OwnerPanelAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        OwnerPanelAccessRequirement requirement)
    {
        if (!int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ||
            !Enum.TryParse<UserRole>(context.User.FindFirstValue(ClaimTypes.Role), out var role))
        {
            return;
        }

        if (role is UserRole.SuperAdmin or UserRole.AdminAssistant or UserRole.Owner or UserRole.OwnerAssistant)
        {
            context.Succeed(requirement);
            return;
        }

        var hasActivePropertyAccess = await dbContext.UserPropertyAccesses.AsNoTracking()
            .AnyAsync(access =>
                access.UserId == userId &&
                access.IsActive &&
                access.Status == PropertyUserStatus.Active);

        if (hasActivePropertyAccess)
        {
            context.Succeed(requirement);
        }
    }
}
