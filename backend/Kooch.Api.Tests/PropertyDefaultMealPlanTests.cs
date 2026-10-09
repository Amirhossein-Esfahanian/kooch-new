using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyDefaultMealPlanTests
{
    [Fact]
    public void PropertyContracts_DoNotExposeLegacyBreakfastFields()
    {
        Type[] contracts =
        [
            typeof(Property), typeof(CreatePropertyRequest), typeof(UpdatePropertyRequest),
            typeof(AdminUpdatePropertyRequest), typeof(UpdatePropertyRulesSectionRequest),
            typeof(PropertyResponse), typeof(PublicPropertyResponse)
        ];

        foreach (var contract in contracts)
        {
            Assert.Null(contract.GetProperty("BreakfastOption"));
            Assert.Null(contract.GetProperty("BreakfastPrice"));
        }
    }

    [Fact]
    public async Task Completion_DoesNotRequireLegacyBreakfastPrice()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var request = CreateRequest();
        request.CheckInTime = new TimeOnly(14, 0);
        request.CheckOutTime = new TimeOnly(12, 0);
        var property = await CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, request);

        var completion = await new PropertyCompletionService(db, null!).CalculateAsync(property.Id);

        Assert.Contains("policies", completion.CompletedSections);
        Assert.DoesNotContain(completion.Sections.SelectMany(section => section.MissingItems),
            item => item.Contains("صبحانه"));
        Assert.DoesNotContain(completion.Warnings, warning => warning.Contains("صبحانه"));
    }

    [Fact]
    public async Task Create_AllowsNullDefaultMealPlan()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var request = CreateRequest();

        var response = await CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, request);

        Assert.Null(response.DefaultMealPlanId);
        Assert.Null(response.DefaultMealPlanName);
        Assert.Null((await db.Properties.SingleAsync()).DefaultMealPlanId);
    }

    [Fact]
    public async Task Create_AcceptsActiveReusableMealPlanAndReturnsMetadata()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        db.MealPlans.Add(new MealPlan { Id = 70, Name = "Breakfast", Slug = "breakfast" });
        await db.SaveChangesAsync();
        var request = CreateRequest();
        request.DefaultMealPlanId = 70;

        var response = await CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, request);

        Assert.Equal(70, response.DefaultMealPlanId);
        Assert.Equal("Breakfast", response.DefaultMealPlanName);
        Assert.Equal("breakfast", response.DefaultMealPlanSlug);
        Assert.Equal(70, (await db.Properties.SingleAsync()).DefaultMealPlanId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Create_RejectsMissingOrDeletedMealPlan(bool deleted)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        if (deleted)
        {
            db.MealPlans.Add(new MealPlan { Id = 70, Name = "Deleted", Slug = "deleted", IsDeleted = true });
            await db.SaveChangesAsync();
        }
        var request = CreateRequest();
        request.DefaultMealPlanId = 70;

        await Assert.ThrowsAsync<ArgumentException>(() =>
            CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, request));
        Assert.Empty(db.Properties);
    }

    [Fact]
    public async Task OwnerAndAdminFullUpdates_ChangePreserveAndClearMealWithoutChangingRoomPlan()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        db.MealPlans.AddRange(
            new MealPlan { Id = 70, Name = "Breakfast", Slug = "breakfast" },
            new MealPlan { Id = 71, Name = "Room only", Slug = "room-only" });
        await db.SaveChangesAsync();
        var service = CreateService(db);
        var create = CreateRequest();
        create.DefaultMealPlanId = 70;
        var property = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, create);
        db.RoomTypes.Add(new RoomType
        {
            PropertyId = property.Id, Name = "Double", Slug = "double", DefaultMealPlanId = 71,
            Description = "Room", MaxAdults = 2, TotalInventory = 1
        });
        await db.SaveChangesAsync();
        var roomTypeId = (await db.RoomTypes.SingleAsync()).Id;
        db.RatePlans.Add(new RatePlan
        {
            RoomTypeId = roomTypeId, Name = "Alternative", MealPlanId = 71,
            PriceModifierType = PriceModifierType.FixedAmount
        });
        await db.SaveChangesAsync();

        var ownerUpdate = UpdateRequest(property.DestinationId);
        ownerUpdate.DefaultMealPlanId = 71;
        var changed = await service.UpdatePropertyAsync(1, UserRole.SuperAdmin, property.Id, ownerUpdate);
        Assert.Equal(71, changed.DefaultMealPlanId);
        ownerUpdate.Name = "Renamed property";
        var preserved = await service.UpdatePropertyAsync(1, UserRole.SuperAdmin, property.Id, ownerUpdate);
        Assert.Equal(71, preserved.DefaultMealPlanId);
        preserved = await service.UpdateBasicSectionAsync(1, UserRole.SuperAdmin, property.Id,
            new UpdatePropertyBasicSectionRequest
            {
                Name = "Section edit", Type = PropertyType.TraditionalHouse,
                InventoryMode = InventoryMode.TypeBasedInventory
            });
        Assert.Equal(71, preserved.DefaultMealPlanId);

        var adminUpdate = AdminUpdateRequest(property.DestinationId);
        adminUpdate.DefaultMealPlanId = 70;
        Assert.Equal(70, (await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, property.Id, adminUpdate)).DefaultMealPlanId);
        adminUpdate.DefaultMealPlanId = null;
        var cleared = await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, property.Id, adminUpdate);
        Assert.Null(cleared.DefaultMealPlanId);
        Assert.Null(cleared.DefaultMealPlanName);

        db.ChangeTracker.Clear();
        var stored = await db.Properties.SingleAsync();
        Assert.Null(stored.DefaultMealPlanId);
        Assert.Equal(71, (await db.RoomTypes.SingleAsync()).DefaultMealPlanId);
        Assert.Equal(71, (await db.RatePlans.SingleAsync()).MealPlanId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FullUpdates_RejectMissingOrDeletedMealPlanWithoutChangingProperty(bool deleted)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        if (deleted)
        {
            db.MealPlans.Add(new MealPlan { Id = 70, Name = "Deleted", Slug = "deleted", IsDeleted = true });
            await db.SaveChangesAsync();
        }
        var service = CreateService(db);
        var property = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());
        var ownerUpdate = UpdateRequest(property.DestinationId);
        ownerUpdate.DefaultMealPlanId = 70;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdatePropertyAsync(1, UserRole.SuperAdmin, property.Id, ownerUpdate));
        var adminUpdate = AdminUpdateRequest(property.DestinationId);
        adminUpdate.DefaultMealPlanId = 70;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, property.Id, adminUpdate));
        Assert.Null((await db.Properties.SingleAsync()).DefaultMealPlanId);
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);

    private static PropertyService CreateService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new PropertyService(db, access, access, new PermissionService(db, access), null!, null!);
    }

    private static async Task SeedAsync(KoochDbContext db)
    {
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Admin", LastName = "User", Email = "admin@example.test", PasswordHash = "hash", Role = UserRole.SuperAdmin, IsActive = true },
            new User { Id = 2, FirstName = "Owner", LastName = "User", Email = "owner@example.test", PasswordHash = "hash", Role = UserRole.Client, IsActive = true });
        db.Destinations.Add(new Destination { Id = 10, Name = "Kashan", Slug = "kashan", Country = "IR" });
        await db.SaveChangesAsync();
    }

    private static CreatePropertyRequest CreateRequest() => new()
    {
        OwnerId = 2, DestinationId = 10, Name = "Test property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse
    };

    private static UpdatePropertyRequest UpdateRequest(int destinationId) => new()
    {
        DestinationId = destinationId, Name = "Updated property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse,
    };

    private static AdminUpdatePropertyRequest AdminUpdateRequest(int destinationId) => new()
    {
        OwnerId = 2, DestinationId = destinationId, Name = "Admin property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse,
        Status = PropertyStatus.Draft
    };
}
