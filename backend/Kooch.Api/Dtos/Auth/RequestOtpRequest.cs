using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class RequestOtpRequest
{
    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;
}
