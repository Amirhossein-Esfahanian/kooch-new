using System.Text;

namespace Kooch.Api.Utilities;

public static class UserIdentityNormalization
{
    public const string DuplicatePhoneNumberMessage = "این شماره موبایل قبلاً ثبت شده است.";
    public const string DuplicateEmailMessage = "این ایمیل قبلاً ثبت شده است.";

    public static string NormalizeName(string value) => value.Trim();

    public static string? NormalizeEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    public static string? NormalizePhoneNumber(string? phoneNumber)
    {
        if (string.IsNullOrWhiteSpace(phoneNumber))
        {
            return null;
        }

        var builder = new StringBuilder();
        foreach (var character in phoneNumber.Trim())
        {
            var normalized = NormalizeDigit(character);
            if (char.IsDigit(normalized) || normalized == '+')
            {
                builder.Append(normalized);
            }
        }

        var value = builder.ToString();
        if (value.StartsWith("0098", StringComparison.Ordinal))
        {
            value = $"0{value[4..]}";
        }
        else if (value.StartsWith("+98", StringComparison.Ordinal))
        {
            value = $"0{value[3..]}";
        }
        else if (value.StartsWith("98", StringComparison.Ordinal) && value.Length == 12)
        {
            value = $"0{value[2..]}";
        }

        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    public static IReadOnlySet<string> BuildPhoneNumberVariants(string phoneNumber)
    {
        var variants = new HashSet<string> { phoneNumber };
        if (phoneNumber.StartsWith('0') && phoneNumber.Length > 1)
        {
            variants.Add($"+98{phoneNumber[1..]}");
            variants.Add($"98{phoneNumber[1..]}");
            variants.Add($"0098{phoneNumber[1..]}");
        }

        return variants;
    }

    private static char NormalizeDigit(char character) =>
        character switch
        {
            >= '\u06F0' and <= '\u06F9' => (char)('0' + character - '\u06F0'),
            >= '\u0660' and <= '\u0669' => (char)('0' + character - '\u0660'),
            _ => character
        };
}
