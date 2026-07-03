namespace Kooch.Api.Dtos.Auth;

public class RequestOtpResponse
{
    public bool Sent { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public string? DevOtpCode { get; set; }
}
