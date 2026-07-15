using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Admin;

public class AdminUserResponse
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public UserRole Role { get; set; }
    public int? ParentUserId { get; set; }
    public string? ParentUserName { get; set; }
    public int? PropertyId { get; set; }
    public string? PropertyName { get; set; }
    public IReadOnlyList<AdminUserPropertyAccessResponse> Properties { get; set; } = [];
    public IReadOnlyList<PermissionKey> Permissions { get; set; } = [];
    public bool IsActive { get; set; }
    public bool PasswordSetupRequired { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? InvitationAcceptedAtUtc { get; set; }
    public string? TemporarySetupLink { get; set; }
}

public class AdminUserPropertyAccessResponse
{
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public PropertyUserStatus Status { get; set; }
    public PropertyUserRole Role { get; set; }
    public bool IsActive { get; set; }
}
