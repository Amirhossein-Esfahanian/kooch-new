using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class LoginRequest
{
    [Required, EmailAddress, MaxLength(320)]
    public string Email { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string Password { get; set; } = string.Empty;
}
