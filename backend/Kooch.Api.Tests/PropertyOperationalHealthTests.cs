using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyOperationalHealthTests
{
    private const string SoldOutWarning = "در ۶۰ روز آینده در حال حاضر اقامت قابل رزروی باقی نمانده است.";

    [Fact]
    public async Task ConfirmedReservationChangesOnlyOperationalWarning()
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today, explicitAvailability: true);

        var before = await CompletionAsync(db);
        var configurationBefore = await ReadinessAsync(db, today);
        Assert.DoesNotContain(SoldOutWarning, before.Warnings);
        Assert.True(before.CanActivate);
        Assert.Equal(100, before.CompletionPercentage);

        AddReservation(db, 10, today);
        await db.SaveChangesAsync();

        var after = await CompletionAsync(db);
        var configurationAfter = await ReadinessAsync(db, today);
        Assert.Equal(configurationBefore.HasJointStandardStay, configurationAfter.HasJointStandardStay);
        Assert.Equal(configurationBefore.ConfiguredCandidates, configurationAfter.ConfiguredCandidates);
        Assert.Contains(SoldOutWarning, after.Warnings);
        Assert.True(after.CanActivate);
        Assert.Equal(100, after.CompletionPercentage);
        Assert.Equal(before.CompletedSections, after.CompletedSections);
        Assert.Equal(before.MissingSections, after.MissingSections);
        Assert.Equal(before.Sections.Select(section => section.Status),
            after.Sections.Select(section => section.Status));
        Assert.Equal(PropertyStatus.Approved, (await db.Properties.SingleAsync()).Status);
    }

    [Fact]
    public async Task OnRequestStandardStayRemainsOperationallyBookable()
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today, explicitAvailability: true);
        (await db.Availabilities.SingleAsync()).Status = AvailabilityStatus.OnRequest;
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.True(completion.CanActivate);
        Assert.DoesNotContain(SoldOutWarning, completion.Warnings);
    }

    [Theory]
    [InlineData(PropertyStatus.Draft)]
    [InlineData(PropertyStatus.PendingReview)]
    [InlineData(PropertyStatus.Rejected)]
    public async Task NonApprovedPropertyDoesNotReceiveOperationalWarning(PropertyStatus status)
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, status, today, explicitAvailability: true);
        AddReservation(db, 10, today);
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.True(completion.CanActivate);
        Assert.DoesNotContain(SoldOutWarning, completion.Warnings);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MissingStandardDailyPriceDoesNotGenerateRedundantWarning(bool addRatePlan)
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today,
            explicitAvailability: true, addPrice: false);
        if (addRatePlan)
        {
            db.RatePlans.Add(new RatePlan
            {
                RoomTypeId = 10, Name = "Alternative", IsActive = true,
                PriceModifierType = PriceModifierType.FixedAmount,
                PriceModifierValue = 100
            });
        }
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.False(completion.CanActivate);
        Assert.Contains("pricing", completion.MissingSections);
        Assert.DoesNotContain(SoldOutWarning, completion.Warnings);
    }

    [Theory]
    [InlineData(AvailabilityStatus.Unavailable, 1, false)]
    [InlineData(AvailabilityStatus.Available, 0, false)]
    [InlineData(AvailabilityStatus.Available, 1, true)]
    public async Task UnconfiguredStandardNightRemainsAConfigurationBlockerOnly(
        AvailabilityStatus status, int capacity, bool isClosed)
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today, explicitAvailability: true);
        var row = await db.Availabilities.SingleAsync();
        row.Status = status;
        row.AvailableCount = capacity;
        row.IsClosed = isClosed;
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.False(completion.CanActivate);
        Assert.Contains("availability", completion.MissingSections);
        Assert.DoesNotContain(SoldOutWarning, completion.Warnings);
    }

    [Fact]
    public async Task MissingAvailabilityRowInheritsCapacityUntilConsumed()
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today);
        Assert.Empty(db.Availabilities);
        Assert.DoesNotContain(SoldOutWarning, (await CompletionAsync(db)).Warnings);

        AddReservation(db, 10, today);
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);
        Assert.True(completion.CanActivate);
        Assert.Equal(100, completion.CompletionPercentage);
        Assert.Contains(SoldOutWarning, completion.Warnings);
    }

    [Fact]
    public async Task AnotherRoomTypeWithLiveStandardStayPreventsWarning()
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today);
        db.RoomTypes.Add(new RoomType
        {
            Id = 20, PropertyId = 100, Name = "Second", Slug = "second",
            IsActive = true, MaxAdults = 2, TotalInventory = 1
        });
        AddPrice(db, 20, today);
        AddReservation(db, 10, today);
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.True(completion.CanActivate);
        Assert.DoesNotContain(SoldOutWarning, completion.Warnings);
    }

    [Theory]
    [InlineData(59, false)]
    [InlineData(60, true)]
    public async Task OperationalHorizonMatchesConfiguredSixtyNights(int secondNightOffset, bool warns)
    {
        await using var db = CreateContext();
        var today = UtcToday();
        await SeedAsync(db, PropertyStatus.Approved, today);
        AddReservation(db, 10, today);
        AddPrice(db, 10, today.AddDays(secondNightOffset));
        await db.SaveChangesAsync();

        var completion = await CompletionAsync(db);

        Assert.True(completion.CanActivate);
        Assert.Equal(warns, completion.Warnings.Contains(SoldOutWarning));
    }

    private static DateOnly UtcToday() => DateOnly.FromDateTime(DateTime.UtcNow);

    private static async Task<Property> SeedAsync(
        KoochDbContext db,
        PropertyStatus status,
        DateOnly date,
        bool explicitAvailability = false,
        bool addPrice = true)
    {
        var property = new Property
        {
            Id = 100, OwnerId = 1, DestinationId = 1, Name = "Property",
            Slug = "property", Description = "Description", City = "City",
            Address = "Address", Country = "IR", Status = status,
            CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0),
            Images = [new PropertyImage { Url = "/property.jpg" }],
            RoomTypes = [new RoomType
            {
                Id = 10, Name = "Standard", Slug = "standard", IsActive = true,
                MaxAdults = 2, TotalInventory = 1, BasePrice = 100
            }]
        };
        db.Properties.Add(property);
        if (addPrice) AddPrice(db, 10, date);
        if (explicitAvailability)
            db.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = date,
                Status = AvailabilityStatus.Available, AvailableCount = 1
            });
        await db.SaveChangesAsync();
        return property;
    }

    private static void AddPrice(KoochDbContext db, int roomTypeId, DateOnly date) =>
        db.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = roomTypeId, Date = date,
            GuestType = PricingGuestType.Iranian, BasePrice = 100
        });

    private static void AddReservation(KoochDbContext db, int roomTypeId, DateOnly date) =>
        db.Reservations.Add(new Reservation
        {
            ClientId = 1, PropertyId = 100, RoomTypeId = roomTypeId,
            CheckInDate = date, CheckOutDate = date.AddDays(1),
            AdultCount = 1, Status = ReservationStatus.Confirmed
        });

    private static Task<PropertyStandardStayReadiness> ReadinessAsync(KoochDbContext db, DateOnly today) =>
        new PropertyStandardStayReadinessService(db).EvaluateAsync(100, today);

    private static Task<Kooch.Api.Dtos.Properties.PropertyCompletionResponse> CompletionAsync(KoochDbContext db) =>
        new PropertyCompletionService(db, null!, new PropertyStandardStayReadinessService(db),
            new PropertyOperationalHealthService(new EffectiveAvailabilityService(db)))
            .CalculateAsync(100);

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
}
