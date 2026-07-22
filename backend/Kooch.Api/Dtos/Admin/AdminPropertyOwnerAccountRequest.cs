using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Admin;

public class AdminPropertyOwnerAccountRequest
{
    [Required, MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string LastName { get; set; } = string.Empty;
    [EmailAddress, MaxLength(320)]
    public string? Email { get; set; }

    [Required, MaxLength(30)]
    public string PhoneNumber { get; set; } = string.Empty;

    [MinLength(8)]
    public string? Password { get; set; }
}
