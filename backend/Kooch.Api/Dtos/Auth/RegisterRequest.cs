using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Auth;

public class RegisterRequest
{
    [Required, MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string LastName { get; set; } = string.Empty;

    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;

    [EmailAddress, MaxLength(320)]
    public string? Email { get; set; }

    [Required, MinLength(8), MaxLength(100)]
    public string Password { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string ConfirmPassword { get; set; } = string.Empty;
}
