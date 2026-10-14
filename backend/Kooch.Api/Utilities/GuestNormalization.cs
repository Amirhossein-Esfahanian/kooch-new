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

    public static bool IsValidIranianNationalCode(string? nationalCode)
    {
        if (nationalCode is null || nationalCode.Any(character =>
                !char.IsWhiteSpace(character) && character != '-' &&
                (NormalizeDigit(character) < '0' || NormalizeDigit(character) > '9')))
        {
            return false;
        }

        var value = NormalizeNationalCode(nationalCode);
        if (value is null || value.Length != 10 || value.Any(digit => digit < '0' || digit > '9') ||
            value.All(digit => digit == value[0]))
        {
            return false;
        }

        var sum = 0;
        for (var index = 0; index < 9; index++)
        {
            sum += (value[index] - '0') * (10 - index);
        }

        var remainder = sum % 11;
        var checkDigit = value[9] - '0';
        return checkDigit == (remainder < 2 ? remainder : 11 - remainder);
    }

    public static string? NormalizePassportNumber(string? passportNumber)
    {
        var value = NormalizeText(passportNumber);
        return value is null ? null : string.Concat(value.Where(character => !char.IsWhiteSpace(character))).ToUpperInvariant();
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
