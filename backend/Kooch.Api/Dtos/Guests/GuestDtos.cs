using System.ComponentModel.DataAnnotations;
using Kooch.Api.Utilities;

namespace Kooch.Api.Dtos.Guests;

public class GuestResponse
{
    public int Id { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? NationalCode { get; set; }
    public string? PassportNumber { get; set; }
    public string? Nationality { get; set; }
    public DateOnly? BirthDate { get; set; }
    public string? Gender { get; set; }
    public string? Address { get; set; }
    public string? Notes { get; set; }
}

public class GuestCreateRequest : IValidatableObject
{
    [MaxLength(100)]
    public string? FirstName { get; set; }

    [MaxLength(100)]
    public string? LastName { get; set; }

    [MaxLength(200)]
    public string? FullName { get; set; }

    [MaxLength(30)]
    public string? Mobile { get; set; }

    [MaxLength(320)]
    public string? Email { get; set; }

    [MaxLength(20)]
    public string? NationalCode { get; set; }

    [MaxLength(50)]
    public string? PassportNumber { get; set; }

    [MaxLength(100)]
    public string? Nationality { get; set; }

    public DateOnly? BirthDate { get; set; }

    [MaxLength(50)]
    public string? Gender { get; set; }

    [MaxLength(1000)]
    public string? Address { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (GuestNormalization.NormalizeText(FirstName) is null &&
            GuestNormalization.NormalizeText(LastName) is null &&
            GuestNormalization.NormalizeText(FullName) is null)
        {
            yield return new ValidationResult(
                "نام یا نام خانوادگی مهمان الزامی است.",
                new[] { nameof(FirstName), nameof(LastName), nameof(FullName) });
        }

        if (GuestNormalization.NormalizeMobile(Mobile) is null &&
            GuestNormalization.NormalizeEmail(Email) is null)
        {
            yield return new ValidationResult(
                "شماره موبایل یا ایمیل مهمان الزامی است.",
                new[] { nameof(Mobile), nameof(Email) });
        }

        foreach (var result in ValidateContactFields(Email, Mobile))
        {
            yield return result;
        }
    }

    public static IEnumerable<ValidationResult> ValidateContactFields(string? email, string? mobile)
    {
        if (!GuestNormalization.IsValidEmail(email))
        {
            yield return new ValidationResult(
                "فرمت ایمیل معتبر نیست.",
                new[] { nameof(Email) });
        }

        if (!GuestNormalization.IsValidMobile(mobile))
        {
            yield return new ValidationResult(
                "فرمت شماره موبایل معتبر نیست.",
                new[] { nameof(Mobile) });
        }
    }
}

public class GuestUpdateRequest : IValidatableObject
{
    [MaxLength(100)]
    public string? FirstName { get; set; }

    [MaxLength(100)]
    public string? LastName { get; set; }

    [MaxLength(200)]
    public string? FullName { get; set; }

    [MaxLength(30)]
    public string? Mobile { get; set; }

    [MaxLength(320)]
    public string? Email { get; set; }

    [MaxLength(20)]
    public string? NationalCode { get; set; }

    [MaxLength(50)]
    public string? PassportNumber { get; set; }

    [MaxLength(100)]
    public string? Nationality { get; set; }

    public DateOnly? BirthDate { get; set; }

    [MaxLength(50)]
    public string? Gender { get; set; }

    [MaxLength(1000)]
    public string? Address { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (GuestNormalization.NormalizeText(FirstName) is null &&
            GuestNormalization.NormalizeText(LastName) is null &&
            GuestNormalization.NormalizeText(FullName) is null)
        {
            yield return new ValidationResult(
                "نام یا نام خانوادگی مهمان الزامی است.",
                new[] { nameof(FirstName), nameof(LastName), nameof(FullName) });
        }

        foreach (var result in GuestCreateRequest.ValidateContactFields(Email, Mobile))
        {
            yield return result;
        }
    }
}

public class GuestSearchRequest
{
    [MaxLength(200)]
    public string? Query { get; set; }

    [MaxLength(30)]
    public string? Mobile { get; set; }

    [MaxLength(320)]
    public string? Email { get; set; }

    [MaxLength(20)]
    public string? NationalCode { get; set; }

    [MaxLength(50)]
    public string? PassportNumber { get; set; }

    public bool IncludeDeleted { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}
