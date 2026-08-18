using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class RequestOtpRequest
{
    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;

    public bool AllowRegistration { get; set; }

    [MaxLength(100)]
    public string? FirstName { get; set; }

    [MaxLength(100)]
    public string? LastName { get; set; }

    [EmailAddress, MaxLength(320)]
    public string? Email { get; set; }
}
