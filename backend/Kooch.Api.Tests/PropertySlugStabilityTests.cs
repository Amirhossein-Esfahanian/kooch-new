using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySlugStabilityTests
{
    [Fact]
    public async Task Create_KeepsEnglishNameSlugAndExistingFallback()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);

        var namedRequest = CreateRequest();
        namedRequest.EnglishName = "Example Hotel";
        var named = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, namedRequest);
        var unnamed = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());

        Assert.Equal("example-hotel", named.Slug);
        Assert.Equal($"property-{unnamed.Id}", unnamed.Slug);
    }

    [Fact]
    public async Task Create_StillRejectsDuplicateEnglishSlug()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var request = CreateRequest();
        request.EnglishName = "Example Hotel";
        await service.CreatePropertyAsync(1, UserRole.SuperAdmin, request);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreatePropertyAsync(1, UserRole.SuperAdmin, request));
        Assert.Single(await db.Properties.ToListAsync());
    }

    [Fact]
    public async Task OwnerFullUpdate_PreservesSlugAcrossEnglishNameAndUnrelatedEdits()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var property = await CreateNamedPropertyAsync(service);
        var request = UpdateRequest();
        request.EnglishName = "New Hotel";

        var renamed = await service.UpdatePropertyAsync(2, UserRole.Client, property.Id, request);
        Assert.Equal("old-hotel", renamed.Slug);
        Assert.Equal("New Hotel", renamed.EnglishName);

        request.EnglishName = "";
        var cleared = await service.UpdatePropertyAsync(2, UserRole.Client, property.Id, request);
        Assert.Equal("old-hotel", cleared.Slug);
        Assert.Null(cleared.EnglishName);

        request.EnglishName = null;
        request.Description = "Unrelated update";
        Assert.Equal("old-hotel", (await service.UpdatePropertyAsync(2, UserRole.Client, property.Id, request)).Slug);
    }

    [Fact]
    public async Task OwnerBasicSection_PreservesSlugWhenEnglishNameChangesOrClears()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var property = await CreateNamedPropertyAsync(service);
        var request = new UpdatePropertyBasicSectionRequest
        {
            Name = "Updated", EnglishName = "New Hotel", Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.TypeBasedInventory
        };

        Assert.Equal("old-hotel", (await service.UpdateBasicSectionAsync(2, UserRole.Client, property.Id, request)).Slug);
        request.EnglishName = null;
        Assert.Equal("old-hotel", (await service.UpdateBasicSectionAsync(2, UserRole.Client, property.Id, request)).Slug);
    }

    [Fact]
    public async Task AdminFullUpdate_PreservesSlugAndPublicLookupAfterEnglishNameEdit()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var property = await CreateNamedPropertyAsync(service);
        var request = AdminUpdateRequest();
        request.EnglishName = "New Hotel";

        var updated = await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, property.Id, request);
        Assert.Equal("old-hotel", updated.Slug);
        request.EnglishName = null;
        Assert.Equal("old-hotel", (await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, property.Id, request)).Slug);

        (await db.Properties.SingleAsync()).Status = PropertyStatus.Approved;
        await db.SaveChangesAsync();
        Assert.Equal(property.Id, (await service.GetPublicPropertyBySlugAsync("old-hotel"))?.Id);
        Assert.Null(await service.GetPublicPropertyBySlugAsync("new-hotel"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task OwnerUpdate_RepairsOnlyMissingSlug(string missingSlug)
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var property = await CreateNamedPropertyAsync(service);
        (await db.Properties.SingleAsync()).Slug = missingSlug;
        await db.SaveChangesAsync();
        var request = UpdateRequest();
        request.EnglishName = "New Hotel";

        var repaired = await service.UpdatePropertyAsync(2, UserRole.Client, property.Id, request);

        Assert.Equal("new-hotel", repaired.Slug);
    }

    private static async Task<PropertyResponse> CreateNamedPropertyAsync(PropertyService service)
    {
        var request = CreateRequest();
        request.EnglishName = "Old Hotel";
        return await service.CreatePropertyAsync(1, UserRole.SuperAdmin, request);
    }

    private static PropertyService CreateService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new PropertyService(db, access, access, new PermissionService(db, access), null!, null!);
    }

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);

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
        OwnerId = 2, DestinationId = 10, Name = "Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse
    };

    private static UpdatePropertyRequest UpdateRequest() => new()
    {
        DestinationId = 10, Name = "Updated Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse
    };

    private static AdminUpdatePropertyRequest AdminUpdateRequest() => new()
    {
        OwnerId = 2, DestinationId = 10, Name = "Admin Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse,
        Status = PropertyStatus.Draft
    };
}
