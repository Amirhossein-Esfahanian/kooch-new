namespace Kooch.Api.Services;

public static class PasswordPolicy
{
    public const string Description =
        "Password must be at least 8 characters and include a lowercase letter and a number.";

    public static void Validate(string password)
    {
        if (password.Length < 8 ||
            !password.Any(char.IsLower) ||
            !password.Any(char.IsDigit))
        {
            throw new ArgumentException(Description);
        }
    }
}
