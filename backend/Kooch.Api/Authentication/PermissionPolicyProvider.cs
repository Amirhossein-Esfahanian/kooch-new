using Kooch.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Authentication;

public class PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
    : DefaultAuthorizationPolicyProvider(options)
{
    public override async Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (!policyName.StartsWith(AuthorizationPolicies.PermissionPrefix, StringComparison.Ordinal))
        {
            return await base.GetPolicyAsync(policyName);
        }

        var permissionName = policyName[AuthorizationPolicies.PermissionPrefix.Length..];
        if (!Enum.TryParse<PermissionKey>(permissionName, out var permissionKey))
        {
            return null;
        }

        return new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(permissionKey))
            .Build();
    }
}
