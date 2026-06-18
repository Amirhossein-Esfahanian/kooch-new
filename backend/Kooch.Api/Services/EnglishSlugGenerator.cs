using System.Globalization;
using System.Text;

namespace Kooch.Api.Services;

internal static class EnglishSlugGenerator
{
    public static string Create(string? englishName, string fallbackPrefix, string? existingSlug = null)
    {
        var slug = Slugify(englishName);
        if (slug.Length > 0)
        {
            return slug;
        }

        if (IsEnglishSafe(existingSlug))
        {
            return existingSlug!.Trim().ToLowerInvariant();
        }

        return $"{fallbackPrefix}-{Guid.NewGuid():N}";
    }

    public static string NormalizeLookup(string slug) => slug.Trim().ToLowerInvariant();

    public static string CreateWithEntityFallback(
        string? englishName,
        string fallbackPrefix,
        int id,
        string? existingSlug = null)
    {
        var slug = Slugify(englishName);
        if (slug.Length > 0)
        {
            return slug;
        }

        return $"{fallbackPrefix}-{id}";
    }

    private static string Slugify(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        var pendingSeparator = false;

        foreach (var character in value.Trim().Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(character);
            if (lower is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                if (pendingSeparator && builder.Length > 0)
                {
                    builder.Append('-');
                }

                builder.Append(lower);
                pendingSeparator = false;
            }
            else
            {
                pendingSeparator = true;
            }
        }

        return builder.ToString();
    }

    private static bool IsEnglishSafe(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var trimmed = value.Trim();
        return trimmed.All(character =>
            character is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-');
    }
}
