using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Exceptions;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyCompletionV2Phase1Tests
{
    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public async Task OptionalContent_DoesNotReduceActivationOrPercentage(bool hasEnglishName, bool hasAmenities)
    {
        await using var db = CreateContext();
        await SeedCompletePropertyAsync(db, hasEnglishName, hasAmenities);

        var completion = await new PropertyCompletionService(db, null!).CalculateAsync(100);

        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Empty(completion.MissingSections);
        Assert.All(completion.Sections, section => Assert.Equal(
            Kooch.Api.Dtos.Properties.PropertyCompletionSectionStatus.Complete, section.Status));
        Assert.Empty(completion.Sections.Single(section => section.Key == "basic").MissingItems);
        Assert.Empty(completion.Sections.Single(section => section.Key == "amenities").MissingItems);
        Assert.Equal(!hasEnglishName, completion.Warnings.Contains("نام انگلیسی اقامتگاه ثبت نشده است."));
        Assert.Equal(!hasAmenities, completion.Warnings.Contains("امکانات اقامتگاه ثبت نشده است."));
        Assert.Equal(completion.Warnings.Count(warning => warning == "نام انگلیسی اقامتگاه ثبت نشده است."), hasEnglishName ? 0 : 1);
        Assert.Equal(completion.Warnings.Count(warning => warning == "امکانات اقامتگاه ثبت نشده است."), hasAmenities ? 0 : 1);
    }

    [Theory]
    [InlineData("name", "basic")]
    [InlineData("description", "basic")]
    [InlineData("city", "location")]
    [InlineData("address", "location")]
    [InlineData("image", "images")]
    [InlineData("check-in", "policies")]
    [InlineData("check-out", "policies")]
    [InlineData("room", "rooms")]
    [InlineData("child-rule", "financial")]
    [InlineData("child-price", "financial")]
    [InlineData("extra-price", "financial")]
    [InlineData("price", "pricing")]
    [InlineData("availability", "availability")]
    public async Task ExistingHardBlockers_RemainBlocking(string missing, string sectionKey)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        switch (missing)
        {
            case "name": property.Name = ""; break;
            case "description": property.Description = ""; break;
            case "city": property.City = ""; break;
            case "address": property.Address = ""; break;
            case "image": db.PropertyImages.RemoveRange(db.PropertyImages); break;
            case "check-in": property.CheckInTime = null; break;
            case "check-out": property.CheckOutTime = null; break;
            case "room": (await db.RoomTypes.SingleAsync()).IsActive = false; break;
            case "child-rule": property.FreeChildAgeLimit = null; break;
            case "child-price": property.ChildPrice = null; break;
            case "extra-price": property.ExtraGuestPrice = 0; break;
            case "price": (await db.RoomTypes.SingleAsync()).BasePrice = null; break;
            case "availability": db.Availabilities.RemoveRange(db.Availabilities); break;
        }
        await db.SaveChangesAsync();

        var completion = await new PropertyCompletionService(db, null!).CalculateAsync(100);

        Assert.False(completion.CanActivate);
        Assert.Contains(sectionKey, completion.MissingSections);
        Assert.NotEmpty(completion.Sections.Single(section => section.Key == sectionKey).MissingItems);
        Assert.True(completion.CompletionPercentage < 100);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    public async Task ApprovedTransition_AllowsMissingOptionalContent(bool hasEnglishName, bool hasAmenities)
    {
        await using var db = CreateContext();
        await SeedCompletePropertyAsync(db, hasEnglishName, hasAmenities);
        var service = CreateService(db);

        var response = await service.SetPropertyStatusAsync(1, UserRole.SuperAdmin, 100, PropertyStatus.Approved);

        Assert.Equal(PropertyStatus.Approved, response.Status);
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
    }

    [Fact]
    public async Task ApprovedTransition_StillRejectsMissingHardBlocker()
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.Description = "";
        await db.SaveChangesAsync();
        var service = CreateService(db);

        var failure = await Assert.ThrowsAsync<PropertyActivationException>(() =>
            service.SetPropertyStatusAsync(1, UserRole.SuperAdmin, 100, PropertyStatus.Approved));

        Assert.Contains("basic", failure.Completion.MissingSections);
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
    }

    private static async Task<Property> SeedCompletePropertyAsync(KoochDbContext db, bool hasEnglishName, bool hasAmenities)
    {
        db.Users.Add(new User
        {
            Id = 1, FirstName = "Admin", LastName = "User", Email = "admin@example.test",
            PasswordHash = "hash", Role = UserRole.SuperAdmin, IsActive = true
        });
        db.Destinations.Add(new Destination { Id = 10, Name = "Kashan", Slug = "kashan", Country = "IR" });
        var property = new Property
        {
            Id = 100, OwnerId = 1, DestinationId = 10, Name = "Property",
            EnglishName = hasEnglishName ? "Property" : null, Slug = "property",
            Description = "Description", City = "Kashan", Address = "Address", Country = "IR",
            Status = PropertyStatus.Draft, CheckInTime = new TimeOnly(14, 0),
            CheckOutTime = new TimeOnly(12, 0), FreeChildAgeLimit = 5,
            MaxFreeChildren = 1, ChildPrice = 100m, ExtraGuestPrice = 100m,
            Images = [new PropertyImage { Url = "/property.jpg" }],
            RoomTypes = [new RoomType
            {
                Name = "Double", Slug = "double", MaxAdults = 2, TotalInventory = 1,
                BasePrice = 1000m, IsActive = true,
                Availability = [new Availability
                {
                    Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),
                    Status = AvailabilityStatus.Available, AvailableCount = 1
                }]
            }]
        };
        if (hasAmenities)
        {
            property.PropertyAmenities.Add(new PropertyAmenity { AmenityId = 20 });
        }
        db.Properties.Add(property);
        await db.SaveChangesAsync();
        return property;
    }

    private static PropertyService CreateService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new PropertyService(db, access, access, new PermissionService(db, access),
            new PropertyCompletionService(db, access), null!);
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
}
