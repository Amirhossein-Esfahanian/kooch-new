using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyAmenityServiceEligibilityTests
{
    [Theory]
    [InlineData(AmenityScope.Property)]
    [InlineData(AmenityScope.Both)]
    public async Task Replace_AllowsPropertyCompatibleAmenity(AmenityScope scope)
    {
        await using var context = await CreateContextAsync();
        var amenity = await SeedAmenityAsync(context, scope);
        var service = new PropertyAmenityService(
            context,
            new PropertyAccessService(context));

        var result = await service.ReplaceAsync(
            1,
            UserRole.SuperAdmin,
            10,
            new SetPropertyAmenitiesRequest { AmenityIds = [amenity.Id] });

        Assert.Contains(result, item => item.AmenityId == amenity.Id);
        Assert.True(await context.PropertyAmenities.AnyAsync(
            join => join.PropertyId == 10 && join.AmenityId == amenity.Id));
    }

    [Fact]
    public async Task Add_RejectsRoomTypeOnlyAmenityWithoutCreatingAssignment()
    {
        await using var context = await CreateContextAsync();
        var amenity = await SeedAmenityAsync(context, AmenityScope.RoomType);
        var service = new PropertyAmenityService(
            context,
            new PropertyAccessService(context));

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.AddAsync(
                1,
                UserRole.SuperAdmin,
                10,
                new SetPropertyAmenitiesRequest { AmenityIds = [amenity.Id] }));

        Assert.Equal("One or more amenities are invalid for a property.", exception.Message);
        Assert.Empty(await context.PropertyAmenities.ToListAsync());
    }

    private static async Task<KoochDbContext> CreateContextAsync()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"property-amenity-scope-{Guid.NewGuid():N}")
            .Options;
        var context = new KoochDbContext(options);
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
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "IR",
            Status = PropertyStatus.Approved
        });
        await context.SaveChangesAsync();
        return context;
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
}
