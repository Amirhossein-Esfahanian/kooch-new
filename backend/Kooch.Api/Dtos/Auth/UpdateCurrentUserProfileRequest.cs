using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Auth;

public sealed class UpdateCurrentUserProfileRequest
{
    [Required, MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string LastName { get; set; } = string.Empty;
}
