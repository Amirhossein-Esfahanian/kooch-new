using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class LoginRequest
{
    [MaxLength(320)]
    public string Identifier { get; set; } = string.Empty;

    [MaxLength(320)]
    public string? Email { get; set; }

    [Required, MaxLength(100)]
    public string Password { get; set; } = string.Empty;
}
