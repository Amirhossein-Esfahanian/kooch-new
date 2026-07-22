namespace Kooch.Api.Dtos.Users;

public sealed record UserIdentityInput(
    string FirstName,
    string LastName,
    string PhoneNumber,
    string? Email);
