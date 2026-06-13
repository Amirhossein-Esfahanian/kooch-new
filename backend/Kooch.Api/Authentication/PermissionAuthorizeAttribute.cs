using Kooch.Api.Entities;
using Microsoft.AspNetCore.Authorization;

namespace Kooch.Api.Authentication;

public sealed class PermissionAuthorizeAttribute : AuthorizeAttribute
{
    public PermissionAuthorizeAttribute(PermissionKey permissionKey)
    {
        Policy = $"{AuthorizationPolicies.PermissionPrefix}{permissionKey}";
    }
}
