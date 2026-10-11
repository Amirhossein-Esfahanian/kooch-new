using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyStandardStayReadinessTests
{
    private static readonly DateOnly Today = new(2035, 2, 1);

    [Theory]
    [InlineData(false, PricingGuestType.Iranian, 0, false)]
    [InlineData(true, PricingGuestType.Foreign, 100, false)]
    [InlineData(true, PricingGuestType.Iranian, 0, false)]
    [InlineData(true, PricingGuestType.Iranian, 100, true)]
    public async Task PricingRequiresPositiveIranianDailyPrice(
        bool addDailyPrice, PricingGuestType guestType, decimal amount, bool expected)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        if (addDailyPrice) AddPrice(db, 10, Today, guestType, amount);
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.Equal(expected, result.HasValidDailyPricing);
        Assert.Equal(expected, result.HasJointStandardStay);
    }

    [Fact]
    public async Task MissingAvailabilityInheritsRoomTypeInventory()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        AddPrice(db, 10, Today);
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.True(result.HasValidConfiguredAvailability);
        Assert.True(result.HasJointStandardStay);
        Assert.Empty(db.Availabilities);
    }

    [Theory]
    [InlineData(AvailabilityStatus.Available, 1, false, true)]
    [InlineData(AvailabilityStatus.OnRequest, 1, false, true)]
    [InlineData(AvailabilityStatus.Unavailable, 1, false, false)]
    [InlineData(AvailabilityStatus.Available, 0, false, false)]
    [InlineData(AvailabilityStatus.Available, 1, true, false)]
    public async Task ExplicitAvailabilityControlsConfiguredSellability(
        AvailabilityStatus status, int count, bool isClosed, bool expected)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        AddPrice(db, 10, Today);
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = Today, Status = status,
            AvailableCount = count, IsClosed = isClosed
        });
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.True(result.HasValidDailyPricing);
        Assert.Equal(expected, result.HasJointStandardStay);
    }

    [Fact]
    public async Task PriceAndAvailabilityOnDifferentRoomTypesDoNotFormAStay()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        db.RoomTypes.Add(new RoomType
        {
            Id = 20, PropertyId = 100, Name = "Second", Slug = "second",
            IsActive = true, MaxAdults = 2, TotalInventory = 1
        });
        AddPrice(db, 10, Today);
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = Today,
            Status = AvailabilityStatus.Unavailable, AvailableCount = 0
        });
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.True(result.HasValidDailyPricing);
        Assert.True(result.HasValidConfiguredAvailability);
        Assert.False(result.HasJointStandardStay);
    }

    [Fact]
    public async Task PriceAndAvailabilityOnDifferentDatesDoNotFormAStay()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        AddPrice(db, 10, Today);
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = Today,
            Status = AvailabilityStatus.Unavailable, AvailableCount = 0
        });
        db.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = Today.AddDays(1),
            Status = AvailabilityStatus.Available, AvailableCount = 1
        });
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.True(result.HasValidDailyPricing);
        Assert.True(result.HasValidConfiguredAvailability);
        Assert.False(result.HasJointStandardStay);
    }

    [Fact]
    public async Task RatePlanWithoutStandardDailyPriceDoesNotQualify()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        db.RatePlans.Add(new RatePlan
        {
            RoomTypeId = 10, Name = "Alternative", IsActive = true,
            PriceModifierType = PriceModifierType.FixedAmount,
            PriceModifierValue = 100
        });
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.False(result.HasValidDailyPricing);
        Assert.False(result.HasJointStandardStay);
    }

    [Fact]
    public async Task ConfirmedReservationDoesNotConsumeApprovalConfiguration()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        AddPrice(db, 10, Today);
        db.Reservations.Add(new Reservation
        {
            ClientId = 1, PropertyId = 100, RoomTypeId = 10,
            CheckInDate = Today, CheckOutDate = Today.AddDays(1),
            AdultCount = 1, Status = ReservationStatus.Confirmed
        });
        await db.SaveChangesAsync();

        var readiness = await EvaluateAsync(db);
        var live = await new EffectiveAvailabilityService(db)
            .GetRangeAsync([10], Today, Today.AddDays(1));

        Assert.True(readiness.HasJointStandardStay);
        Assert.False(live[10].HasCapacityForFullRange(1));
    }

    [Theory]
    [InlineData(false, 2, 1)]
    [InlineData(true, 0, 1)]
    [InlineData(true, 2, 0)]
    public async Task OnlyActiveBaselineCapableRoomTypesQualify(
        bool isActive, int maxAdults, int totalInventory)
    {
        await using var db = CreateContext();
        var roomType = await SeedAsync(db);
        roomType.IsActive = isActive;
        roomType.MaxAdults = maxAdults;
        roomType.TotalInventory = totalInventory;
        AddPrice(db, 10, Today);
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.False(result.HasValidDailyPricing);
        Assert.False(result.HasJointStandardStay);
    }

    [Theory]
    [InlineData(59, true)]
    [InlineData(60, false)]
    public async Task HorizonIncludesOnlyTheNextSixtyNights(int offset, bool expected)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        AddPrice(db, 10, Today.AddDays(offset));
        await db.SaveChangesAsync();

        var result = await EvaluateAsync(db);

        Assert.Equal(expected, result.HasValidDailyPricing);
        Assert.Equal(expected, result.HasJointStandardStay);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CompletionAndApprovalFollowJointCandidate(bool available)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPrice(db, 10, today);
        if (!available)
            db.Availabilities.Add(new Availability
            {
                RoomTypeId = 10, Date = today,
                Status = AvailabilityStatus.Unavailable, AvailableCount = 0
            });
        await db.SaveChangesAsync();

        var completion = await new PropertyCompletionService(
            db, null!, new PropertyStandardStayReadinessService(db),
            new PropertyOperationalHealthService(new EffectiveAvailabilityService(db)))
            .CalculateAsync(100);

        Assert.Equal(available, completion.CanActivate);
        Assert.Equal(available ? 100 : 89, completion.CompletionPercentage);
        Assert.Equal(available, completion.CompletedSections.Contains("availability"));
        Assert.Equal(!available, completion.MissingSections.Contains("availability"));
    }

    private static Task<PropertyStandardStayReadiness> EvaluateAsync(KoochDbContext db) =>
        new PropertyStandardStayReadinessService(db).EvaluateAsync(100, Today);

    private static void AddPrice(KoochDbContext db, int roomTypeId, DateOnly date,
        PricingGuestType guestType = PricingGuestType.Iranian, decimal amount = 100) =>
        db.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = roomTypeId, Date = date, GuestType = guestType, BasePrice = amount
        });

    private static async Task<RoomType> SeedAsync(KoochDbContext db)
    {
        var property = new Property
        {
            Id = 100, OwnerId = 1, DestinationId = 1,
            Name = "Property", Slug = "property", Description = "Description",
            Address = "Address", City = "City", Country = "IR",
            CheckInTime = new TimeOnly(14, 0), CheckOutTime = new TimeOnly(12, 0),
            Images = [new PropertyImage { Url = "/property.jpg" }]
        };
        var roomType = new RoomType
        {
            Id = 10, Name = "Standard", Slug = "standard", IsActive = true,
            MaxAdults = 2, TotalInventory = 1, BasePrice = 100
        };
        property.RoomTypes.Add(roomType);
        db.Properties.Add(property);
        await db.SaveChangesAsync();
        return roomType;
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
}
