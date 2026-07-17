namespace Kooch.Api.Dtos.Admin;

public class AdminPropertyOwnerAccountResponse
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public bool IsActive { get; set; }
    public bool PasswordSetupRequired { get; set; }
    public string? TemporarySetupLink { get; set; }
}
