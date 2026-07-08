using System.Text;

namespace Kooch.Api.Utilities;

public static class GuestNormalization
{
    public static string? NormalizeText(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    public static string? NormalizeEmail(string? email)
    {
        var normalized = NormalizeText(email);
        return normalized?.ToLowerInvariant();
    }

    public static string? NormalizeMobile(string? mobile)
    {
        var normalized = NormalizeText(mobile);
        if (normalized is null) return null;

        var builder = new StringBuilder();
        foreach (var character in normalized)
        {
            var digit = NormalizeDigit(character);
            if (char.IsDigit(digit) || digit == '+')
            {
                builder.Append(digit);
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

    public static string? NormalizeNationalCode(string? nationalCode)
    {
        var normalized = NormalizeText(nationalCode);
        if (normalized is null) return null;

        var builder = new StringBuilder();
        foreach (var character in normalized)
        {
            var digit = NormalizeDigit(character);
            if (char.IsDigit(digit))
            {
                builder.Append(digit);
            }
        }

        return builder.Length == 0 ? null : builder.ToString();
    }

    public static bool IsValidEmail(string? email)
    {
        var normalized = NormalizeEmail(email);
        return normalized is null || new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(normalized);
    }

    public static bool IsValidMobile(string? mobile)
    {
        var normalized = NormalizeMobile(mobile);
        if (normalized is null) return true;

        var digitsOnly = normalized.StartsWith('+')
            ? normalized[1..]
            : normalized;

        return digitsOnly.Length is >= 8 and <= 15 && digitsOnly.All(char.IsDigit);
    }

    private static char NormalizeDigit(char character) =>
        character switch
        {
            >= '۰' and <= '۹' => (char)('0' + character - '۰'),
            >= '٠' and <= '٩' => (char)('0' + character - '٠'),
            _ => character
        };
}
