using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
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

        var completion = await CreateCompletionService(db).CalculateAsync(100);

        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Empty(completion.MissingSections);
        Assert.All(completion.Sections, section => Assert.Equal(
            Kooch.Api.Dtos.Properties.PropertyCompletionSectionStatus.Complete, section.Status));
        Assert.Empty(completion.Sections.Single(section => section.Key == "basic").MissingItems);
        Assert.Equal(5, completion.Sections.Count);
        Assert.Equal(!hasEnglishName, completion.Warnings.Contains("نام انگلیسی اقامتگاه ثبت نشده است."));
        Assert.Equal(!hasAmenities, completion.Warnings.Contains("امکانات اقامتگاه ثبت نشده است."));
        Assert.Equal(completion.Warnings.Count(warning => warning == "نام انگلیسی اقامتگاه ثبت نشده است."), hasEnglishName ? 0 : 1);
        Assert.Equal(completion.Warnings.Count(warning => warning == "امکانات اقامتگاه ثبت نشده است."), hasAmenities ? 0 : 1);
    }

    [Theory]
    [InlineData("name", "basic")]
    [InlineData("description", "descriptions")]
    [InlineData("country", "location")]
    [InlineData("city", "location")]
    [InlineData("address", "location")]
    [InlineData("image", "images")]
    [InlineData("check-in", "policies")]
    [InlineData("check-out", "policies")]
    [InlineData("blank-name", "basic")]
    [InlineData("blank-country", "location")]
    [InlineData("blank-city", "location")]
    [InlineData("blank-address", "location")]
    [InlineData("blank-description", "descriptions")]
    [InlineData("blank-image", "images")]
    [InlineData("deleted-image", "images")]
    [InlineData("room-image", "images")]
    public async Task ExistingHardBlockers_RemainBlocking(string missing, string sectionKey)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        switch (missing)
        {
            case "name": property.Name = ""; break;
            case "description": property.Description = ""; break;
            case "country": property.Country = ""; break;
            case "city": property.City = ""; break;
            case "address": property.Address = ""; break;
            case "image": db.PropertyImages.RemoveRange(db.PropertyImages); break;
            case "check-in": property.CheckInTime = null; break;
            case "check-out": property.CheckOutTime = null; break;
            case "blank-name": property.Name = "  "; break;
            case "blank-country": property.Country = "  "; break;
            case "blank-city": property.City = "  "; break;
            case "blank-address": property.Address = "  "; break;
            case "blank-description": property.Description = "  "; break;
            case "blank-image": property.Images.Single().Url = "  "; break;
            case "deleted-image": property.Images.Single().IsDeleted = true; break;
            case "room-image": property.Images.Single().RoomTypeId = property.RoomTypes.Single().Id; break;
        }
        await db.SaveChangesAsync();

        var completion = await CreateCompletionService(db).CalculateAsync(100);

        Assert.False(completion.CanActivate);
        Assert.Contains(sectionKey, completion.MissingSections);
        Assert.NotEmpty(completion.Sections.Single(section => section.Key == sectionKey).MissingItems);
        Assert.Equal(80, completion.CompletionPercentage);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    public async Task ApprovedTransition_AllowsMissingOptionalContent(bool hasEnglishName, bool hasAmenities)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, hasEnglishName, hasAmenities);
        property.FreeChildAgeLimit = null;
        property.MaxFreeChildren = null;
        property.ChildPrice = null;
        property.ExtraGuestPrice = null;
        await db.SaveChangesAsync();
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

        Assert.Contains("descriptions", failure.Completion.MissingSections);
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
    }

    [Theory]
    [InlineData(null, 1, null)]
    [InlineData(5, null, null)]
    [InlineData(null, null, null)]
    [InlineData(null, null, 0)]
    [InlineData(null, null, 100)]
    public async Task OptionalChildRulesAndPrice_DoNotBlockFinancialCompletion(
        int? freeChildAgeLimit, int? maxFreeChildren, int? childPrice)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.FreeChildAgeLimit = freeChildAgeLimit;
        property.MaxFreeChildren = maxFreeChildren;
        property.ChildPrice = childPrice;
        property.ExtraGuestPrice = null;
        await db.SaveChangesAsync();

        var completion = await CreateCompletionService(db).CalculateAsync(100);

        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.DoesNotContain("financial", completion.MissingSections);
        Assert.DoesNotContain(completion.Warnings, warning => warning.Contains("قیمت کودک") || warning.Contains("تنظیمات مالی"));
    }

    [Theory]
    [InlineData(true, true, 2, null, true)]
    [InlineData(true, true, 2, 0, true)]
    [InlineData(true, true, 2, 100, true)]
    [InlineData(false, true, 2, null, true)]
    [InlineData(true, false, 2, null, true)]
    [InlineData(true, true, 0, null, true)]
    public async Task ExtraGuestConfiguration_DoesNotAffectApproval(
        bool isActive, bool allowExtraGuest, int maxExtraGuests, int? extraGuestPrice, bool financialComplete)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        var roomType = property.RoomTypes.Single();
        roomType.IsActive = isActive;
        roomType.AllowExtraGuest = allowExtraGuest;
        roomType.MaxExtraGuests = maxExtraGuests;
        property.ExtraGuestPrice = extraGuestPrice;
        await db.SaveChangesAsync();

        var completion = await CreateCompletionService(db).CalculateAsync(100);
        Assert.Equal(financialComplete, completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Empty(completion.MissingSections);
        Assert.DoesNotContain("قیمت نفر اضافه ثبت نشده است.", completion.Warnings);
    }

    [Fact]
    public async Task NoRoomTypes_DoesNotInventFinancialRequirement()
    {
        await using var db = CreateContext();
        await SeedCompletePropertyAsync(db, false, false);
        db.Availabilities.RemoveRange(db.Availabilities);
        db.RoomDailyPrices.RemoveRange(db.RoomDailyPrices);
        db.RoomTypes.RemoveRange(db.RoomTypes);
        var property = await db.Properties.SingleAsync();
        property.ExtraGuestPrice = null;
        await db.SaveChangesAsync();

        var completion = await CreateCompletionService(db).CalculateAsync(100);

        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Empty(completion.MissingSections);

        var approved = await CreateService(db).ApprovePropertyAsync(1, UserRole.SuperAdmin, 100);
        Assert.Equal(PropertyStatus.Approved, approved.Status);
    }

    [Fact]
    public async Task OneActiveCapableRoomTypeAmongMultiple_DoesNotRequireExtraGuestPriceForApproval()
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.ExtraGuestPrice = null;
        property.RoomTypes.Add(new RoomType
        {
            Name = "Extra", Slug = "extra", MaxAdults = 2, TotalInventory = 1,
            IsActive = true, AllowExtraGuest = true, MaxExtraGuests = 2
        });
        await db.SaveChangesAsync();

        var approved = await CreateService(db).SetPropertyStatusAsync(1, UserRole.SuperAdmin, 100, PropertyStatus.Approved);
        Assert.Equal(PropertyStatus.Approved, approved.Status);
    }

    [Theory]
    [InlineData("no-price")]
    [InlineData("zero-inventory")]
    [InlineData("outside-horizon")]
    [InlineData("no-availability")]
    public async Task BookingConfigurationDoesNotAffectApproval(string configuration)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.ExtraGuestPrice = null;
        property.FloorsCount = null;
        switch (configuration)
        {
            case "no-price": db.RoomDailyPrices.RemoveRange(db.RoomDailyPrices); break;
            case "zero-inventory":
                property.RoomTypes.Single().TotalInventory = 0;
                var availability = await db.Availabilities.SingleAsync();
                availability.AvailableCount = 0;
                availability.Status = AvailabilityStatus.Unavailable;
                availability.IsClosed = true;
                break;
            case "outside-horizon":
                (await db.RoomDailyPrices.SingleAsync()).Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(90);
                break;
            case "no-availability": db.Availabilities.RemoveRange(db.Availabilities); break;
        }
        await db.SaveChangesAsync();

        var completion = await CreateCompletionService(db).CalculateAsync(100);
        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Empty(completion.MissingSections);
        Assert.DoesNotContain(completion.Sections, section =>
            section.Key is "rooms" or "financial" or "pricing" or "availability");
        Assert.Equal(PropertyStatus.Approved,
            (await CreateService(db).ApprovePropertyAsync(1, UserRole.SuperAdmin, 100)).Status);
    }

    [Fact]
    public async Task DraftCreationDoesNotRequireApprovalContent()
    {
        await using var db = CreateContext();
        await SeedCompletePropertyAsync(db, false, false);
        var draft = await CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, new CreatePropertyRequest
        {
            OwnerId = 2, DestinationId = 10, Name = "New Draft", EnglishName = "New Draft",
            Country = "Iran", City = "Kashan", Address = "Address"
        });

        Assert.Equal(PropertyStatus.Draft, draft.Status);
        var completion = await CreateCompletionService(db).CalculateAsync(draft.Id);
        Assert.False(completion.CanActivate);
        Assert.Equal(new[] { "descriptions", "images", "policies" }, completion.MissingSections);
    }

    [Theory]
    [InlineData("owner-inactive")]
    [InlineData("owner-role")]
    [InlineData("destination")]
    public async Task ApprovalPreservesOwnerAndDestinationIntegrity(string invalid)
    {
        await using var db = CreateContext();
        await SeedCompletePropertyAsync(db, false, false);
        if (invalid == "owner-inactive") (await db.Users.SingleAsync(user => user.Id == 2)).IsActive = false;
        if (invalid == "owner-role") (await db.Users.SingleAsync(user => user.Id == 2)).Role = UserRole.SuperAdmin;
        if (invalid == "destination") (await db.Destinations.SingleAsync()).IsDeleted = true;
        await db.SaveChangesAsync();

        var error = await Record.ExceptionAsync(() => CreateService(db).ApprovePropertyAsync(1, UserRole.SuperAdmin, 100));
        if (invalid == "owner-inactive") Assert.IsType<InvalidOperationException>(error);
        else Assert.IsType<ArgumentException>(error);
        Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AdminFullUpdateChecksSubmittedInformationBeforeApproving(bool complete)
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.Description = complete ? "" : "Original description";
        await db.SaveChangesAsync();
        var request = new AdminUpdatePropertyRequest
        {
            OwnerId = 2, DestinationId = 10, Name = "Updated Property", Country = "Iran", City = "Kashan",
            Address = "Address", Description = complete ? "Updated description" : "  ",
            CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0),
            Status = PropertyStatus.Approved
        };
        if (complete)
        {
            var result = await CreateService(db).UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, 100, request);
            Assert.Equal(PropertyStatus.Approved, result.Status);
            Assert.Equal("Updated description", result.Description);
        }
        else
        {
            await Assert.ThrowsAsync<PropertyActivationException>(() =>
                CreateService(db).UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, 100, request));
            db.ChangeTracker.Clear();
            Assert.Equal(PropertyStatus.Draft, (await db.Properties.SingleAsync()).Status);
            Assert.Equal("Original description", (await db.Properties.SingleAsync()).Description);
        }
    }

    [Theory]
    [InlineData("checkInTime")]
    [InlineData("checkOutTime")]
    public void InvalidClockTimesAreRejectedByRequestDeserialization(string field)
    {
        Assert.Throws<System.Text.Json.JsonException>(() =>
            System.Text.Json.JsonSerializer.Deserialize<CreatePropertyRequest>(
                $"{{\"{field}\":\"25:00:00\"}}", new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
    }

    [Fact]
    public async Task MidnightIsAValidClockTime()
    {
        await using var db = CreateContext();
        var property = await SeedCompletePropertyAsync(db, false, false);
        property.CheckInTime = TimeOnly.MinValue;
        property.CheckOutTime = TimeOnly.MinValue;
        await db.SaveChangesAsync();
        Assert.True((await CreateCompletionService(db).CalculateAsync(100)).CanActivate);
    }

    private static async Task<Property> SeedCompletePropertyAsync(KoochDbContext db, bool hasEnglishName, bool hasAmenities)
    {
        db.Users.Add(new User
        {
            Id = 1, FirstName = "Admin", LastName = "User", Email = "admin@example.test",
            PasswordHash = "hash", Role = UserRole.SuperAdmin, IsActive = true
        });
        db.Destinations.Add(new Destination { Id = 10, Name = "Kashan", Slug = "kashan", Country = "IR" });
        db.Users.Add(new User
        {
            Id = 2, FirstName = "Owner", LastName = "User", Email = "owner@example.test",
            PasswordHash = "hash", Role = UserRole.Client, IsActive = true
        });
        var property = new Property
        {
            Id = 100, OwnerId = 2, DestinationId = 10, Name = "Property",
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
                DailyPrices = [new RoomDailyPrice
                {
                    Date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),
                    GuestType = PricingGuestType.Iranian, BasePrice = 1000m
                }],
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
            CreateCompletionService(db, access), null!);
    }

    private static PropertyCompletionService CreateCompletionService(
        KoochDbContext db,
        IPropertyAccessService? access = null) =>
        new(db, access!);

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
}
