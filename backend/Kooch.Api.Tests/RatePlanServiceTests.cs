using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RatePlanServiceTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-300000)]
    [InlineData(200000)]
    public async Task Create_PersistsSignedFixedModifierAndTrimmedName(decimal modifier)
    {
        await using var db = await CreateContextAsync();
        var result = await Service(db).CreateAsync(1, UserRole.SuperAdmin, 10, 20,
            Request(modifier));

        Assert.Equal("Breakfast plan", result.Name);
        Assert.Equal(modifier, result.PriceModifierValue);
        Assert.Equal(PriceModifierType.FixedAmount, result.PriceModifierType);
        Assert.Equal("Breakfast", result.MealPlanName);
        Assert.Equal("breakfast", result.MealPlanSlug);
        Assert.Equal(40, result.CancellationPolicyId);
        Assert.Equal(modifier, (await db.RatePlans.SingleAsync()).PriceModifierValue);
    }

    [Fact]
    public async Task Create_RejectsPercentageAndInvalidFields()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        var percentage = Request(10);
        percentage.PriceModifierType = PriceModifierType.Percentage;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, percentage));

        var emptyName = Request(0);
        emptyName.Name = "   ";
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, emptyName));

        var minimum = Request(0);
        minimum.MinimumNights = 0;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, minimum));

        var precision = Request(0.001m);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, precision));
        Assert.Empty(db.RatePlans);
    }

    [Fact]
    public async Task Create_RejectsWrongRoomTypeOrUnauthorizedActor()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 999, Request(0)));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 21, Request(0)));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateAsync(2, UserRole.Client, 10, 20, Request(0)));
        Assert.Empty(db.RatePlans);
    }

    [Fact]
    public async Task Create_RejectsInvalidMealPlanAndCrossPropertyPolicy()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        var missingMeal = Request(0);
        missingMeal.MealPlanId = 999;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, missingMeal));

        var deletedMeal = Request(0);
        deletedMeal.MealPlanId = 31;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, deletedMeal));

        var foreignPolicy = Request(0);
        foreignPolicy.CancellationPolicyId = 41;
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, foreignPolicy));
        Assert.Empty(db.RatePlans);
    }

    [Fact]
    public async Task NegativeModifier_RejectsKnownNonPositiveBaseOrTodayPrice()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, Request(-3000000)));

        db.RoomDailyPrices.Add(new RoomDailyPrice
        {
            RoomTypeId = 20,
            Date = DateOnly.FromDateTime(DateTime.UtcNow),
            BasePrice = 200000
        });
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, Request(-300000)));
        Assert.Empty(db.RatePlans);
    }

    [Fact]
    public async Task UpdateAndDelete_RespectScopeAndSoftDelete()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        var created = await service.CreateAsync(1, UserRole.SuperAdmin, 10, 20, Request(0));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.GetAsync(1, UserRole.SuperAdmin, 11, 21, created.Id));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.UpdateAsync(1, UserRole.SuperAdmin, 11, 21, created.Id, UpdateRequest(50)));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.DeleteAsync(1, UserRole.SuperAdmin, 11, 21, created.Id));

        var updated = await service.UpdateAsync(1, UserRole.SuperAdmin, 10, 20, created.Id, UpdateRequest(50));
        Assert.Equal(50, updated.PriceModifierValue);
        Assert.False(updated.IsActive);
        Assert.Single(await service.ListAsync(1, UserRole.SuperAdmin, 10, 20));

        await service.DeleteAsync(1, UserRole.SuperAdmin, 10, 20, created.Id);
        var deleted = await db.RatePlans.IgnoreQueryFilters().SingleAsync();
        Assert.True(deleted.IsDeleted);
        Assert.False(deleted.IsActive);
        Assert.NotNull(deleted.DeletedAtUtc);
        Assert.Equal(1, deleted.DeletedByUserId);
        Assert.Empty(await service.ListAsync(1, UserRole.SuperAdmin, 10, 20));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.GetAsync(1, UserRole.SuperAdmin, 10, 20, created.Id));
    }

    [Fact]
    public async Task MealPlanCatalog_ReturnsOnlyNonDeletedAndRequiresRoomManagement()
    {
        await using var db = await CreateContextAsync();
        var service = Service(db);
        var options = await service.ListMealPlansAsync(1, UserRole.SuperAdmin, 10);
        Assert.Equal(30, Assert.Single(options).Id);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListMealPlansAsync(2, UserRole.Client, 10));
    }

    [Fact]
    public async Task GlobalMealPlanCatalog_DoesNotRequirePropertyAndReturnsOrderedUsableOptions()
    {
        var dbOptions = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"meal-plan-reference-{Guid.NewGuid():N}")
            .Options;
        await using var db = new KoochDbContext(dbOptions);
        db.MealPlans.AddRange(
            new MealPlan { Id = 32, Name = "A", Slug = "a-2" },
            new MealPlan { Id = 33, Name = "A", Slug = "a-1" },
            new MealPlan { Id = 30, Name = "Breakfast", Slug = "breakfast" },
            new MealPlan { Id = 31, Name = "Deleted", Slug = "deleted", IsDeleted = true });
        await db.SaveChangesAsync();

        var options = await Service(db).ListReferenceMealPlansAsync();
        Assert.Equal([32, 33, 30], options.Select(option => option.Id));
        Assert.Equal(["A", "A", "Breakfast"], options.Select(option => option.Name));
        Assert.Equal(["a-2", "a-1", "breakfast"], options.Select(option => option.Slug));
        Assert.DoesNotContain(options, option => option.Id == 31);
        Assert.All(options, option => Assert.Equal(3, option.GetType().GetProperties().Length));
    }

    private static RatePlanService Service(KoochDbContext db) => new(db, new PropertyAccessService(db));

    private static CreateRatePlanRequest Request(decimal modifier) => new()
    {
        Name = "  Breakfast plan  ",
        MealPlanId = 30,
        CancellationPolicyId = 40,
        PriceModifierType = PriceModifierType.FixedAmount,
        PriceModifierValue = modifier,
        MinimumNights = 1,
        IsActive = true
    };

    private static UpdateRatePlanRequest UpdateRequest(decimal modifier) => new()
    {
        Name = "Updated",
        PriceModifierType = PriceModifierType.FixedAmount,
        PriceModifierValue = modifier,
        IsActive = false
    };

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"rate-plan-{Guid.NewGuid():N}")
            .Options;
        var db = new KoochDbContext(options);
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Admin", LastName = "User", PasswordHash = "hash", Role = UserRole.SuperAdmin, IsActive = true },
            new User { Id = 2, FirstName = "Client", LastName = "User", PasswordHash = "hash", Role = UserRole.Client, IsActive = true });
        db.Destinations.Add(new Destination { Id = 50, Name = "Kashan", Slug = "kashan", Country = "IR" });
        db.Properties.AddRange(
            new Property { Id = 10, OwnerId = 1, DestinationId = 50, Name = "First", Slug = "first", Description = "Test", Address = "Test", City = "Kashan", Country = "IR", Status = PropertyStatus.Approved },
            new Property { Id = 11, OwnerId = 1, DestinationId = 50, Name = "Second", Slug = "second", Description = "Test", Address = "Test", City = "Kashan", Country = "IR", Status = PropertyStatus.Approved });
        db.RoomTypes.AddRange(
            new RoomType { Id = 20, PropertyId = 10, Name = "Room", Slug = "room", BasePrice = 3000000 },
            new RoomType { Id = 21, PropertyId = 11, Name = "Other room", Slug = "other-room", BasePrice = 3000000 });
        db.MealPlans.AddRange(
            new MealPlan { Id = 30, Name = "Breakfast", Slug = "breakfast" },
            new MealPlan { Id = 31, Name = "Deleted", Slug = "deleted", IsDeleted = true });
        db.CancellationPolicies.AddRange(
            new CancellationPolicy { Id = 40, PropertyId = 10, Name = "Flexible" },
            new CancellationPolicy { Id = 41, PropertyId = 11, Name = "Foreign" });
        await db.SaveChangesAsync();
        return db;
    }
}
