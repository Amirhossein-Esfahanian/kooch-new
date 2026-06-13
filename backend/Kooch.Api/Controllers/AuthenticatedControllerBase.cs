using System.Security.Claims;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

public abstract class AuthenticatedControllerBase : ControllerBase
{
    protected (int UserId, UserRole Role) GetCurrentUser()
    {
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ||
            !Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var role))
        {
            throw new UnauthorizedAccessException("The authenticated user claims are invalid.");
        }

        return (userId, role);
    }
}
