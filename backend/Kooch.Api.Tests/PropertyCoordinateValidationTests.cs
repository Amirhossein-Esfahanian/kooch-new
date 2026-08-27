using System.ComponentModel.DataAnnotations;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyCoordinateValidationTests
{
    public static TheoryData<decimal?, decimal?> ValidCoordinates => new()
    {
        { null, null },
        { 33.985m, 51.410m },
        { -33.985m, -51.410m },
        { -90m, -180m },
        { 90m, 180m }
    };

    public static TheoryData<decimal?, decimal?> InvalidCoordinates => new()
    {
        { 33.985m, null },
        { null, 51.410m },
        { 90.000001m, 51.410m },
        { -90.000001m, 51.410m },
        { 33.985m, 180.000001m },
        { 33.985m, -180.000001m }
    };

    [Theory]
    [MemberData(nameof(ValidCoordinates))]
    public void AllCoordinateWriteContracts_AcceptCanonicalValidValues(
        decimal? latitude,
        decimal? longitude)
    {
        foreach (var request in CoordinateRequests(latitude, longitude))
        {
            Assert.Empty(CoordinateValidationResults(request));
        }
    }

    [Theory]
    [MemberData(nameof(InvalidCoordinates))]
    public void AllCoordinateWriteContracts_RejectCanonicalInvalidValues(
        decimal? latitude,
        decimal? longitude)
    {
        foreach (var request in CoordinateRequests(latitude, longitude))
        {
            var result = Assert.Single(CoordinateValidationResults(request));
            Assert.Contains(nameof(PropertyCoordinatesRequest.Latitude), result.MemberNames);
            Assert.Contains(nameof(PropertyCoordinatesRequest.Longitude), result.MemberNames);
        }
    }

    [Theory]
    [MemberData(nameof(ValidCoordinates))]
    public async Task CreateProperty_PersistsCanonicalValidCoordinates(
        decimal? latitude,
        decimal? longitude)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateService(dbContext);
        var request = CreateRequest();
        request.Latitude = latitude;
        request.Longitude = longitude;

        var created = await service.CreatePropertyAsync(AdminUserId, UserRole.SuperAdmin, request);

        Assert.Equal(latitude, created.Latitude);
        Assert.Equal(longitude, created.Longitude);
    }

    [Theory]
    [MemberData(nameof(InvalidCoordinates))]
    public async Task CreateProperty_RejectsInvalidCoordinatesWithoutPersisting(
        decimal? latitude,
        decimal? longitude)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        var service = CreateService(dbContext);
        var request = CreateRequest();
        request.Latitude = latitude;
        request.Longitude = longitude;

        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreatePropertyAsync(AdminUserId, UserRole.SuperAdmin, request));

        Assert.Empty(await dbContext.Properties.ToListAsync());
    }

    [Theory]
    [InlineData("full")]
    [InlineData("location")]
    [InlineData("admin")]
    public async Task UpdatePaths_PersistValidCoordinatePairs(string path)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        await SeedPropertyAsync(dbContext);
        var service = CreateService(dbContext);

        var updated = path switch
        {
            "full" => await service.UpdatePropertyAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                FullUpdateRequest(-33.985m, -51.410m)),
            "location" => await service.UpdateLocationSectionAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                LocationUpdateRequest(-33.985m, -51.410m)),
            "admin" => await service.UpdatePropertyForAdminAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                AdminUpdateRequest(-33.985m, -51.410m)),
            _ => throw new InvalidOperationException($"Unknown update path: {path}")
        };

        Assert.Equal(-33.985m, updated.Latitude);
        Assert.Equal(-51.410m, updated.Longitude);
    }

    [Theory]
    [InlineData("full")]
    [InlineData("location")]
    [InlineData("admin")]
    public async Task UpdatePaths_RejectInvalidCoordinatesWithoutPartialPersistence(string path)
    {
        await using var dbContext = CreateContext();
        await SeedBaseAsync(dbContext);
        await SeedPropertyAsync(dbContext);
        var service = CreateService(dbContext);

        await Assert.ThrowsAsync<ArgumentException>(() => path switch
        {
            "full" => service.UpdatePropertyAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                FullUpdateRequest(33.985m, null)),
            "location" => service.UpdateLocationSectionAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                LocationUpdateRequest(33.985m, 180.000001m)),
            "admin" => service.UpdatePropertyForAdminAsync(
                AdminUserId,
                UserRole.SuperAdmin,
                PropertyId,
                AdminUpdateRequest(null, 51.410m)),
            _ => throw new InvalidOperationException($"Unknown update path: {path}")
        });

        dbContext.ChangeTracker.Clear();
        var property = await dbContext.Properties.SingleAsync(item => item.Id == PropertyId);
        Assert.Equal("Original address", property.Address);
        Assert.Equal(12.345678m, property.Latitude);
        Assert.Equal(45.678901m, property.Longitude);
    }

    private static PropertyCoordinatesRequest[] CoordinateRequests(decimal? latitude, decimal? longitude)
    {
        var create = CreateRequest();
        create.Latitude = latitude;
        create.Longitude = longitude;
        return
        [
            create,
            FullUpdateRequest(latitude, longitude),
            LocationUpdateRequest(latitude, longitude),
            AdminUpdateRequest(latitude, longitude)
        ];
    }

    private static IReadOnlyList<ValidationResult> CoordinateValidationResults(
        PropertyCoordinatesRequest request)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);
        return results.Where(result =>
            result.MemberNames.Contains(nameof(PropertyCoordinatesRequest.Latitude)) ||
            result.MemberNames.Contains(nameof(PropertyCoordinatesRequest.Longitude))).ToList();
    }

    private static CreatePropertyRequest CreateRequest() => new()
    {
        OwnerId = OwnerUserId,
        DestinationId = DestinationId,
        Name = $"Coordinate property {Guid.NewGuid():N}",
        Description = "Coordinate validation property",
        Address = "Test address",
        City = "Kashan",
        Country = "Iran",
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.TypeBasedInventory
    };

    private static UpdatePropertyRequest FullUpdateRequest(decimal? latitude, decimal? longitude) => new()
    {
        DestinationId = DestinationId,
        Name = "Updated property",
        Description = "Updated description",
        Address = "Changed address",
        City = "Kashan",
        Country = "Iran",
        Latitude = latitude,
        Longitude = longitude,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.TypeBasedInventory
    };

    private static UpdatePropertyLocationSectionRequest LocationUpdateRequest(
        decimal? latitude,
        decimal? longitude) => new()
    {
        DestinationId = DestinationId,
        Address = "Changed address",
        City = "Kashan",
        Country = "Iran",
        Latitude = latitude,
        Longitude = longitude
    };

    private static AdminUpdatePropertyRequest AdminUpdateRequest(decimal? latitude, decimal? longitude) => new()
    {
        OwnerId = OwnerUserId,
        DestinationId = DestinationId,
        Name = "Admin updated property",
        Description = "Admin updated description",
        Address = "Changed address",
        City = "Kashan",
        Country = "Iran",
        Status = PropertyStatus.Draft,
        Type = PropertyType.TraditionalHouse,
        InventoryMode = InventoryMode.TypeBasedInventory,
        Latitude = latitude,
        Longitude = longitude
    };

    private static async Task SeedBaseAsync(KoochDbContext dbContext)
    {
        dbContext.Users.AddRange(
            CreateUser(AdminUserId, UserRole.SuperAdmin, "admin"),
            CreateUser(OwnerUserId, UserRole.Client, "owner"));
        dbContext.Destinations.Add(new Destination
        {
            Id = DestinationId,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        await dbContext.SaveChangesAsync();
    }

    private static async Task SeedPropertyAsync(KoochDbContext dbContext)
    {
        dbContext.Properties.Add(new Property
        {
            Id = PropertyId,
            OwnerId = OwnerUserId,
            DestinationId = DestinationId,
            Name = "Original property",
            Slug = "original-property",
            Description = "Original description",
            Address = "Original address",
            City = "Kashan",
            Country = "Iran",
            Latitude = 12.345678m,
            Longitude = 45.678901m,
            Status = PropertyStatus.Draft,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.TypeBasedInventory
        });
        await dbContext.SaveChangesAsync();
    }

    private static User CreateUser(int id, UserRole role, string identifier) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = $"{identifier}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private static PropertyService CreateService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyService(
            dbContext,
            authorization,
            authorization,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new KoochDbContext(options);
    }

    private const int AdminUserId = 1;
    private const int OwnerUserId = 2;
    private const int DestinationId = 10;
    private const int PropertyId = 100;
}
