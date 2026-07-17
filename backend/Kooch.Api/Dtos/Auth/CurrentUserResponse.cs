using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Auth;

public class CurrentUserResponse
{
    public int UserId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public int? GuestId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public UserRole PlatformRole { get; set; }
    public IReadOnlyList<PermissionKey> PlatformPermissions { get; set; } = [];
    public bool IsActive { get; set; }
    public IReadOnlyList<string> Workspaces { get; set; } = [];
    public IReadOnlyList<CurrentUserPropertyMembershipResponse> PropertyMemberships { get; set; } = [];
    public string? DefaultWorkspace { get; set; }
    public int? DefaultPropertyId { get; set; }

    // Compatibility alias for existing clients. PlatformRole is authoritative.
    public UserRole Role { get; set; }
}

public class CurrentUserPropertyMembershipResponse
{
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public PropertyUserRole PropertyRole { get; set; }
    public PropertyUserStatus MembershipStatus { get; set; }
    public bool IsActive { get; set; }
    public PermissionMatrixDto EffectivePermissions { get; set; } = [];
}

public static class WorkspaceNames
{
    public const string Admin = "admin";
    public const string Owner = "owner";
    public const string Account = "account";
}


