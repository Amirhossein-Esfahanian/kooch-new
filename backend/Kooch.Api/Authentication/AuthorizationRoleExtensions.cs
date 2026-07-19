using Kooch.Api.Entities;

namespace Kooch.Api.Authentication;

public static class AuthorizationRoleExtensions
{
    public static bool IsPlatformAdmin(this UserRole role) =>
        role is UserRole.SuperAdmin or UserRole.AdminAssistant;

    public static UserRole ToCanonicalPlatformRole(this UserRole role) =>
        role.IsPlatformAdmin() ? role : UserRole.Client;

    public static bool IsPropertyRole(this PropertyUserRole role) =>
        Enum.IsDefined(role);
}
