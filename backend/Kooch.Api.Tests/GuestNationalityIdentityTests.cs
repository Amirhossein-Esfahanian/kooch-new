using System.ComponentModel.DataAnnotations;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestNationalityIdentityTests
{
    private const string ValidNationalCode = "1234567891";

    [Fact]
    public void IranianNationalCode_NormalizesDigitsAndChecksChecksum()
    {
        Assert.Equal(ValidNationalCode, GuestNormalization.NormalizeNationalCode("۱۲۳۴۵۶۷۸۹۱"));
        Assert.True(GuestNormalization.IsValidIranianNationalCode("۱۲۳۴۵۶۷۸۹۱"));
        Assert.False(GuestNormalization.IsValidIranianNationalCode("1234567890"));
        Assert.False(GuestNormalization.IsValidIranianNationalCode("1111111111"));
        Assert.False(GuestNormalization.IsValidIranianNationalCode("A1234567891"));
    }

    [Fact]
    public void CreateContract_RequiresExactlyTheSelectedIdentity()
    {
        Assert.Empty(Validate(CreateIranian()));
        Assert.Empty(Validate(CreateForeign("France")));
        var missingNationalCode = CreateIranian();
        missingNationalCode.NationalCode = null;
        Assert.NotEmpty(Validate(missingNationalCode));
        var missingPassport = CreateForeign("France");
        missingPassport.PassportNumber = null;
        Assert.NotEmpty(Validate(missingPassport));
        var mixedForeign = CreateForeign("France");
        mixedForeign.NationalCode = ValidNationalCode;
        Assert.NotEmpty(Validate(mixedForeign));
        var mixedIranian = CreateIranian();
        mixedIranian.PassportNumber = "A123";
        Assert.NotEmpty(Validate(mixedIranian));
    }

    [Fact]
    public async Task IranianIdentity_IsUniqueAcrossCanonicalUserLinks()
    {
        await using var db = CreateContext();
        db.Users.AddRange(User(1, "09120000001"), User(2, "09120000002"));
        await db.SaveChangesAsync();
        var service = new GuestService(db);

        var first = await service.CreateAsync(CreateIranian());
        Assert.Equal(1, first.UserId);
        Assert.Equal(ValidNationalCode, first.NationalCode);
        Assert.Equal("ایران", first.Nationality);
        Assert.Null(first.PassportNumber);

        var duplicate = CreateIranian();
        duplicate.Mobile = "09120000002";
        duplicate.NationalCode = "۱۲۳۴۵۶۷۸۹۱";
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(duplicate));
        Assert.Single(await db.Guests.ToListAsync());
    }

    [Fact]
    public async Task ForeignIdentity_IsUniqueByCountryAndNormalizedPassport()
    {
        await using var db = CreateContext();
        var service = new GuestService(db);
        var first = await service.CreateAsync(CreateForeign("France"));
        Assert.Equal("AB123", first.PassportNumber);
        Assert.Null(first.NationalCode);

        var duplicate = CreateForeign("France");
        duplicate.Mobile = "09120000002";
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(duplicate));
        var otherCountryRequest = CreateForeign("Germany");
        otherCountryRequest.Mobile = "09120000003";
        otherCountryRequest.PassportNumber = "AB123";
        var otherCountry = await service.CreateAsync(otherCountryRequest);
        Assert.Equal("Germany", otherCountry.Nationality);
    }

    [Fact]
    public async Task Edit_SwitchesIdentityWithoutChangingExistingUserLink()
    {
        await using var db = CreateContext();
        db.Users.Add(User(1, "09120000001"));
        await db.SaveChangesAsync();
        var service = new GuestService(db);
        var created = await service.CreateAsync(CreateIranian());
        var foreign = await service.UpdateAsync(created.Id, new GuestUpdateRequest
        {
            FirstName = "Test", Mobile = "09120000001", Nationality = "France", PassportNumber = " ab 123 "
        });

        Assert.Equal(1, foreign.UserId);
        Assert.Null(foreign.NationalCode);
        Assert.Equal("AB123", foreign.PassportNumber);
        Assert.Equal("France", foreign.Nationality);
    }

    [Fact]
    public void Model_HasFilteredIdentityUniqueIndexes()
    {
        using var db = CreateContext();
        var indexes = db.Model.FindEntityType(typeof(Guest))!.GetIndexes();
        Assert.Contains(indexes, index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual([nameof(Guest.NationalCode)]));
        Assert.Contains(indexes, index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual([nameof(Guest.Nationality), nameof(Guest.PassportNumber)]));
    }

    private static GuestCreateRequest CreateIranian() => new()
    {
        FirstName = "Test", Mobile = "09120000001", Nationality = "ایران", NationalCode = ValidNationalCode
    };

    private static GuestCreateRequest CreateForeign(string country) => new()
    {
        FirstName = "Test", Mobile = "09120000001", Nationality = country, PassportNumber = " ab 123 "
    };

    private static User User(int id, string mobile) => new()
    {
        Id = id, FirstName = "Test", LastName = "User", PhoneNumber = mobile,
        PasswordHash = "hash", Role = UserRole.Client
    };

    private static IReadOnlyList<ValidationResult> Validate(GuestCreateRequest request)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(request, new ValidationContext(request), results, true);
        return results;
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
}
