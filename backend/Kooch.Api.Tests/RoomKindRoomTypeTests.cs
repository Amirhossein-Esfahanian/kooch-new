using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Dtos.Pricing;
using Kooch.Api.Dtos.Promotions;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RoomKindRoomTypeTests
{
    [Fact]
    public void Model_PersistsRequiredRoomKindAsInteger()
    {
        using var context = CreateSqlServerContext();

        var property = context.Model.FindEntityType(typeof(RoomType))!
            .FindProperty(nameof(RoomType.RoomKind))!;

        Assert.False(property.IsNullable);
        Assert.Equal(typeof(RoomKind), property.ClrType);
        Assert.Equal("int", property.GetColumnType());
    }

    [Fact]
    public void Migration_AddsOnlyRequiredRoomKindColumnAndBackfillsLegacyRowsAsDouble()
    {
        var migration = new AddRoomKindToRoomType();
        var migrationBuilder = new MigrationBuilder("Microsoft.EntityFrameworkCore.SqlServer");
        typeof(AddRoomKindToRoomType)
            .GetMethod("Up", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(migration, [migrationBuilder]);

        Assert.Equal(2, migrationBuilder.Operations.Count);
        var addColumn = Assert.IsType<AddColumnOperation>(migrationBuilder.Operations[0]);
        Assert.Equal("RoomTypes", addColumn.Table);
        Assert.Equal("RoomKind", addColumn.Name);
        Assert.Equal("int", addColumn.ColumnType);
        Assert.False(addColumn.IsNullable);
        Assert.Equal((int)RoomKind.Double, addColumn.DefaultValue);

        var removeMigrationDefault = Assert.IsType<AlterColumnOperation>(migrationBuilder.Operations[1]);
        Assert.Equal("RoomTypes", removeMigrationDefault.Table);
        Assert.Equal("RoomKind", removeMigrationDefault.Name);
        Assert.Null(removeMigrationDefault.DefaultValue);
        Assert.Equal((int)RoomKind.Double, removeMigrationDefault.OldColumn.DefaultValue);
    }

    [Fact]
    public void Migration_DownRemovesOnlyRoomKindColumn()
    {
        var migration = new AddRoomKindToRoomType();
        var migrationBuilder = new MigrationBuilder("Microsoft.EntityFrameworkCore.SqlServer");
        typeof(AddRoomKindToRoomType)
            .GetMethod("Down", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(migration, [migrationBuilder]);

        var operation = Assert.IsType<DropColumnOperation>(Assert.Single(migrationBuilder.Operations));
        Assert.Equal("RoomTypes", operation.Table);
        Assert.Equal("RoomKind", operation.Name);
    }

    [Fact]
    public void RoomTypeResponses_ExposeEnumAndCatalogCode()
    {
        var responseTypes = new[]
        {
            typeof(RoomTypeResponse),
            typeof(PublicRoomTypeResponse),
            typeof(PublicRoomTypeSummaryResponse),
            typeof(PublicBookingRoomTypeOption),
            typeof(PublicBookingUnavailableRoomType),
            typeof(InventoryRoomTypeResponse),
            typeof(PricingRoomTypeResponse),
            typeof(PromotionRoomTypeResponse)
        };

        Assert.All(responseTypes, type =>
        {
            Assert.Equal(typeof(RoomKind), type.GetProperty("RoomKind")?.PropertyType);
            Assert.Equal(typeof(string), type.GetProperty("RoomKindCode")?.PropertyType);
        });

        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        var json = JsonSerializer.Serialize(
            new RoomTypeResponse { RoomKind = RoomKind.Twin },
            options);

        Assert.Contains("\"roomKind\":\"Twin\"", json);
        Assert.Contains("\"roomKindCode\":\"twin\"", json);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(999)]
    public void CreateAndUpdateRequests_RejectUndefinedRoomKinds(int value)
    {
        AssertInvalidRoomKind(ValidCreateRequest((RoomKind)value));
        AssertInvalidRoomKind(ValidUpdateRequest((RoomKind)value));
    }

    [Fact]
    public async Task CreateAndUpdate_PersistAndReturnRoomKindWithCatalogCode()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());

        var created = await service.CreateRoomTypeAsync(
            1,
            UserRole.SuperAdmin,
            10,
            ValidCreateRequest(RoomKind.Twin));

        Assert.Equal(RoomKind.Twin, created.RoomKind);
        Assert.Equal("twin", created.RoomKindCode);
        var persisted = await context.RoomTypes.SingleAsync();
        Assert.Equal(RoomKind.Twin, persisted.RoomKind);
        Assert.Equal(InventoryMode.TypeBasedInventory, persisted.InventoryMode);
        Assert.Equal("Test room type", persisted.Name);

        var updated = await service.UpdateRoomTypeAsync(
            1,
            UserRole.SuperAdmin,
            created.Id,
            ValidUpdateRequest(RoomKind.JuniorSuite));

        Assert.Equal(RoomKind.JuniorSuite, updated.RoomKind);
        Assert.Equal("junior-suite", updated.RoomKindCode);
        persisted = await context.RoomTypes.SingleAsync();
        Assert.Equal(RoomKind.JuniorSuite, persisted.RoomKind);
        Assert.Equal(InventoryMode.TypeBasedInventory, persisted.InventoryMode);
    }

    [Fact]
    public async Task DefaultMealPlan_CreateUpdateAndClear_UsesActiveMealPlanWithoutChangingLegacyBreakfast()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var property = await context.Properties.SingleAsync();
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Breakfast", Slug = "breakfast" });
        await context.SaveChangesAsync();
        var service = new RoomTypeService(context, new PropertyAccessService(context), new NoOpAuditLogService());

        var created = await service.CreateRoomTypeAsync(1, UserRole.SuperAdmin, 10, ValidCreateRequest(RoomKind.Double));
        Assert.Null(created.DefaultMealPlanId);
        var update = ValidUpdateRequest(RoomKind.Double);
        update.DefaultMealPlanId = 70;
        var assigned = await service.UpdateRoomTypeAsync(1, UserRole.SuperAdmin, created.Id, update);
        Assert.Equal(70, assigned.DefaultMealPlanId);
        Assert.Equal("Breakfast", assigned.DefaultMealPlanName);
        Assert.Equal("breakfast", assigned.DefaultMealPlanSlug);
        Assert.Equal(70, (await service.GetRoomTypesByPropertyAsync(1, UserRole.SuperAdmin, 10)).Single().DefaultMealPlanId);

        update.DefaultMealPlanId = null;
        var cleared = await service.UpdateRoomTypeAsync(1, UserRole.SuperAdmin, created.Id, update);
        Assert.Null(cleared.DefaultMealPlanId);
        Assert.Null(cleared.DefaultMealPlanName);
        Assert.Null((await context.RoomTypes.SingleAsync()).DefaultMealPlanId);
    }

    [Fact]
    public async Task DefaultMealPlan_CreateWithValidMealPlan_PersistsAndReturnsMetadata()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Room only", Slug = "room-only" });
        await context.SaveChangesAsync();
        var service = new RoomTypeService(context, new PropertyAccessService(context), new NoOpAuditLogService());
        var request = ValidCreateRequest(RoomKind.Double);
        request.DefaultMealPlanId = 70;

        var created = await service.CreateRoomTypeAsync(1, UserRole.SuperAdmin, 10, request);

        Assert.Equal(70, created.DefaultMealPlanId);
        Assert.Equal("Room only", created.DefaultMealPlanName);
        Assert.Equal("room-only", created.DefaultMealPlanSlug);
        Assert.Equal(70, (await context.RoomTypes.SingleAsync()).DefaultMealPlanId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DefaultMealPlan_RejectsMissingOrSoftDeletedMealPlan(bool deleted)
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        if (deleted)
        {
            context.MealPlans.Add(new MealPlan { Id = 70, Name = "Deleted", Slug = "deleted", IsDeleted = true });
            await context.SaveChangesAsync();
        }
        var service = new RoomTypeService(context, new PropertyAccessService(context), new NoOpAuditLogService());
        var create = ValidCreateRequest(RoomKind.Double);
        create.DefaultMealPlanId = 70;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateRoomTypeAsync(1, UserRole.SuperAdmin, 10, create));
        Assert.Empty(context.RoomTypes);

        var existing = await service.CreateRoomTypeAsync(1, UserRole.SuperAdmin, 10, ValidCreateRequest(RoomKind.Double));
        var update = ValidUpdateRequest(RoomKind.Double);
        update.DefaultMealPlanId = 70;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdateRoomTypeAsync(1, UserRole.SuperAdmin, existing.Id, update));
        Assert.Null((await context.RoomTypes.SingleAsync()).DefaultMealPlanId);
    }

    [Fact]
    public void RoomTypeRequests_AllowZeroInventoryAndRejectNegativeInventory()
    {
        var create = ValidCreateRequest(RoomKind.Double);
        var update = ValidUpdateRequest(RoomKind.Double);
        create.TotalInventory = 0;
        update.TotalInventory = 0;

        Assert.True(IsValid(create));
        Assert.True(IsValid(update));

        create.TotalInventory = -1;
        update.TotalInventory = -1;
        Assert.False(IsValid(create));
        Assert.False(IsValid(update));
    }

    [Fact]
    public async Task CreateAndUpdate_IgnoreLegacyInventoryModeAndUseCanonicalValue()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var create = ValidCreateRequest(RoomKind.Double);
        create.InventoryMode = null;
        create.TotalInventory = 0;

        var created = await service.CreateRoomTypeAsync(
            1, UserRole.SuperAdmin, 10, create);

        Assert.Equal(0, created.TotalInventory);
        Assert.Equal(InventoryMode.TypeBasedInventory, created.InventoryMode);

        var update = ValidUpdateRequest(RoomKind.Twin);
        update.InventoryMode = InventoryMode.NamedRooms;
        update.TotalInventory = 3;
        var updated = await service.UpdateRoomTypeAsync(
            1, UserRole.SuperAdmin, created.Id, update);

        Assert.Equal(3, updated.TotalInventory);
        Assert.Equal(InventoryMode.TypeBasedInventory, updated.InventoryMode);
    }

    [Theory]
    [InlineData(2, 0)]
    [InlineData(10, 1)]
    public async Task UpdateLegacyActiveRoomType_AllowsNumericInventoryBeyondPhysicalRoomCount(
        int totalInventory,
        int physicalRoomCount)
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var roomType = new RoomType
        {
            PropertyId = 10,
            Name = "Legacy named room type",
            Slug = "legacy-named-room-type",
            Description = "Legacy room type created before completion checks.",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
            RoomKind = RoomKind.Double,
            IsActive = true
        };
        context.RoomTypes.Add(roomType);
        for (var index = 0; index < physicalRoomCount; index++)
        {
            roomType.Rooms.Add(new Room
            {
                Name = $"Physical room {index + 1}",
                IsActive = true
            });
        }
        await context.SaveChangesAsync();
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var request = ValidUpdateRequest(RoomKind.Double);
        request.TotalInventory = totalInventory;
        request.IsActive = true;

        var updated = await service.UpdateRoomTypeAsync(
            1,
            UserRole.SuperAdmin,
            roomType.Id,
            request);

        Assert.Equal(totalInventory, updated.TotalInventory);
        Assert.Equal(InventoryMode.TypeBasedInventory, updated.InventoryMode);
        Assert.Equal(physicalRoomCount, await context.Rooms.CountAsync());
    }

    [Fact]
    public async Task UpdateInactiveRoomType_StillRequiresCompletionBeforeActivation()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var created = await service.CreateRoomTypeAsync(
            1,
            UserRole.SuperAdmin,
            10,
            ValidCreateRequest(RoomKind.Double));
        var request = ValidUpdateRequest(RoomKind.Double);
        request.TotalInventory = 10;
        request.IsActive = true;

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateRoomTypeAsync(
                1,
                UserRole.SuperAdmin,
                created.Id,
                request));

        Assert.Contains("Room cannot be activated", exception.Message);
        Assert.False((await context.RoomTypes.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task UpdateWithoutBasePrice_PreservesTheLegacyCompatibilityValue()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var create = ValidCreateRequest(RoomKind.Double);
        create.BasePrice = 2_500_000;
        var created = await service.CreateRoomTypeAsync(
            1, UserRole.SuperAdmin, 10, create);

        var update = ValidUpdateRequest(RoomKind.Double);
        update.BasePrice = null;
        await service.UpdateRoomTypeAsync(
            1, UserRole.SuperAdmin, created.Id, update);

        Assert.Equal(
            2_500_000,
            (await context.RoomTypes.SingleAsync()).BasePrice);
    }

    [Fact]
    public async Task Service_RejectsUndefinedRoomKindEvenWhenCalledOutsideModelBinding()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateRoomTypeAsync(
                1,
                UserRole.SuperAdmin,
                10,
                ValidCreateRequest((RoomKind)999)));

        Assert.Equal("roomKind", exception.ParamName);
        Assert.Empty(context.RoomTypes);
    }

    [Theory]
    [InlineData(AmenityScope.Property, false)]
    [InlineData(AmenityScope.RoomType, true)]
    [InlineData(AmenityScope.Both, true)]
    public async Task CreateRoomType_EnforcesAmenityScope(
        AmenityScope scope,
        bool expectedAllowed)
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var amenity = await SeedAmenityAsync(context, scope);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var request = ValidCreateRequest(RoomKind.Double);
        request.AmenityIds = [amenity.Id];

        if (!expectedAllowed)
        {
            var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
                service.CreateRoomTypeAsync(1, UserRole.SuperAdmin, 10, request));

            Assert.Equal("One or more amenities are invalid for a room type.", exception.Message);
            Assert.Empty(await context.RoomTypeAmenities.ToListAsync());
            return;
        }

        var created = await service.CreateRoomTypeAsync(
            1, UserRole.SuperAdmin, 10, request);

        Assert.Contains(created.Amenities, item => item.AmenityId == amenity.Id);
    }

    [Fact]
    public async Task UpdateRoomType_RejectsPropertyOnlyAmenityAndPreservesExistingAssignments()
    {
        await using var context = CreateContext();
        await SeedPropertyAsync(context);
        var roomAmenity = await SeedAmenityAsync(context, AmenityScope.RoomType);
        var propertyAmenity = await SeedAmenityAsync(context, AmenityScope.Property);
        var service = new RoomTypeService(
            context,
            new PropertyAccessService(context),
            new NoOpAuditLogService());
        var create = ValidCreateRequest(RoomKind.Double);
        create.AmenityIds = [roomAmenity.Id];
        var created = await service.CreateRoomTypeAsync(
            1, UserRole.SuperAdmin, 10, create);
        var update = ValidUpdateRequest(RoomKind.Double);
        update.AmenityIds = [propertyAmenity.Id];

        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdateRoomTypeAsync(
                1, UserRole.SuperAdmin, created.Id, update));

        var persisted = Assert.Single(await context.RoomTypeAmenities.ToListAsync());
        Assert.Equal(roomAmenity.Id, persisted.AmenityId);
    }

    private static void AssertInvalidRoomKind(object request)
    {
        var results = new List<ValidationResult>();
        var valid = Validator.TryValidateObject(
            request,
            new ValidationContext(request),
            results,
            validateAllProperties: true);

        Assert.False(valid);
        Assert.Contains(results, result => result.MemberNames.Contains("RoomKind"));
    }

    private static bool IsValid(object request) =>
        Validator.TryValidateObject(
            request,
            new ValidationContext(request),
            new List<ValidationResult>(),
            validateAllProperties: true);

    private static CreateRoomTypeRequest ValidCreateRequest(RoomKind roomKind) =>
        new()
        {
            Name = "Test room type",
            Description = "Test description",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            RoomKind = roomKind,
            IsActive = false
        };

    private static UpdateRoomTypeRequest ValidUpdateRequest(RoomKind roomKind) =>
        new()
        {
            Name = "Updated room type",
            Description = "Updated description",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            RoomKind = roomKind,
            IsActive = false
        };

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"room-kind-room-type-{Guid.NewGuid():N}")
            .Options;
        return new KoochDbContext(options);
    }

    private static async Task<Amenity> SeedAmenityAsync(
        KoochDbContext context,
        AmenityScope scope)
    {
        var category = new AmenityCategory
        {
            Name = "Scope category",
            Slug = $"scope-category-{Guid.NewGuid():N}",
            IsActive = true
        };
        var amenity = new Amenity
        {
            AmenityCategory = category,
            Name = $"{scope} amenity",
            Slug = $"scope-amenity-{Guid.NewGuid():N}",
            Scope = scope
        };
        context.Amenities.Add(amenity);
        await context.SaveChangesAsync();
        return amenity;
    }

    private static KoochDbContext CreateSqlServerContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=(localdb)\\mssqllocaldb;Database=KoochRoomKindModelTest;Trusted_Connection=True")
            .Options;
        return new KoochDbContext(options);
    }

    private static async Task SeedPropertyAsync(KoochDbContext context)
    {
        context.Users.Add(new User
        {
            Id = 1,
            FirstName = "Admin",
            LastName = "User",
            PasswordHash = "hash",
            Role = UserRole.SuperAdmin,
            IsActive = true
        });
        context.Destinations.Add(new Destination
        {
            Id = 20,
            Name = "Kashan",
            Slug = "kashan",
            Country = "IR"
        });
        context.Properties.Add(new Property
        {
            Id = 10,
            OwnerId = 1,
            DestinationId = 20,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test description",
            Address = "Test address",
            City = "Kashan",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        await context.SaveChangesAsync();
    }
}
