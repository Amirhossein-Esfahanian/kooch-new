using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public class SetPasswordRequest
{
    [Required]
    public string Token { get; set; } = string.Empty;

    [Required, MinLength(8)]
    public string NewPassword { get; set; } = string.Empty;

    [Required, MinLength(8)]
    public string ConfirmPassword { get; set; } = string.Empty;
}

public enum PasswordSetupTokenStatus
{
    Valid,
    Invalid,
    Expired,
    Used
}

public class PasswordSetupTokenStatusResponse
{
    public PasswordSetupTokenStatus Status { get; set; }
    public bool CanSetPassword => Status == PasswordSetupTokenStatus.Valid;
}
