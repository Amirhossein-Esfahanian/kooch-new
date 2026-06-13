using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Auth;

public class CurrentUserResponse
{
    public int UserId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public UserRole Role { get; set; }
}
