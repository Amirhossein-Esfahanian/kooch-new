using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.PropertyUsers;

public class PropertyUserRequest
{
    [MaxLength(200)]
    public string? FullName { get; set; }
    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;

    [EmailAddress, MaxLength(320)]
    public string? Email { get; set; }

    [MaxLength(100)]
    public string? Username { get; set; }

    [Required]
    public PropertyUserStatus Status { get; set; } = PropertyUserStatus.Active;

    [Required]
    public PropertyUserRole Role { get; set; } = PropertyUserRole.Manager;

    public bool IsActive { get; set; } = true;
    public PermissionMatrixDto? Permissions { get; set; }
}
