using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class VerifyOtpRequest
{
    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;

    [Required, MaxLength(12)]
    public string Code { get; set; } = string.Empty;
}
