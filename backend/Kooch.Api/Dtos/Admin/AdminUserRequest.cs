using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Admin;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public class AdminUserRequest
{
    [Required, MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string LastName { get; set; } = string.Empty;

    [Required, EmailAddress, MaxLength(320)]
    public string Email { get; set; } = string.Empty;

    [MaxLength(30)]
    public string? PhoneNumber { get; set; }

    [MinLength(8)]
    public string? Password { get; set; }

    [Required]
    public UserRole Role { get; set; }

    public int? ParentUserId { get; set; }
    public IReadOnlyList<string> Permissions { get; set; } = [];
}
