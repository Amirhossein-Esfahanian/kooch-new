using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.PropertyUsers;

public class PropertyUserResponse
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int PropertyId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Mobile { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public PropertyUserStatus Status { get; set; }
    public PropertyUserRole Role { get; set; }
    public bool IsActive { get; set; }
    public bool CanRemove { get; set; }
}
