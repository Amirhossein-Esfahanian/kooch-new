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
        Assert.Equal(RoomKind.Twin, (await context.RoomTypes.SingleAsync()).RoomKind);

        var updated = await service.UpdateRoomTypeAsync(
            1,
            UserRole.SuperAdmin,
            created.Id,
            ValidUpdateRequest(RoomKind.JuniorSuite));

        Assert.Equal(RoomKind.JuniorSuite, updated.RoomKind);
        Assert.Equal("junior-suite", updated.RoomKindCode);
        Assert.Equal(RoomKind.JuniorSuite, (await context.RoomTypes.SingleAsync()).RoomKind);
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

    private static CreateRoomTypeRequest ValidCreateRequest(RoomKind roomKind) =>
        new()
        {
            Name = "Test room type",
            Description = "Test description",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
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
            InventoryMode = InventoryMode.NamedRooms,
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
