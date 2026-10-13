using System.Text.RegularExpressions;

namespace Kooch.Api.Services.SiteSettings;

public static partial class BookingSupportPhoneSetting
{
    public const string Key = "site.bookingSupportPhone";

    public static string Normalize(string? input)
    {
        var value = input?.Trim() ?? string.Empty;
        if (value.Length == 0) return string.Empty;

        if (!PhoneCharacters().IsMatch(value))
        {
            throw new ArgumentException("شماره تماس پشتیبانی رزرو معتبر نیست.");
        }

        var normalized = new string(value.Where(character => char.IsAsciiDigit(character) || character == '+').ToArray());
        var digitCount = normalized.Length - (normalized.StartsWith('+') ? 1 : 0);
        if (digitCount is < 7 or > 15)
        {
            throw new ArgumentException("شماره تماس پشتیبانی رزرو باید بین ۷ تا ۱۵ رقم داشته باشد.");
        }

        return normalized;
    }

    [GeneratedRegex(@"^\+?[0-9][0-9\s().-]*[0-9]$")]
    private static partial Regex PhoneCharacters();
}
