using Kooch.Api.Entities;

namespace Kooch.Api.Services;

internal static class PropertyUserAuthorizationRules
{
    public static bool CanManageTargetRole(
        PropertyUserRole actorRole,
        PropertyUserRole targetRole) =>
        RoleRank(targetRole) <= RoleRank(actorRole);

    private static int RoleRank(PropertyUserRole role) =>
        role switch
        {
            PropertyUserRole.PropertyOwner => 100,
            PropertyUserRole.Manager => 80,
            PropertyUserRole.Accounting => 60,
            PropertyUserRole.Reception => 50,
            PropertyUserRole.Housekeeping => 40,
            PropertyUserRole.Custom => 10,
            _ => 0
        };
}
