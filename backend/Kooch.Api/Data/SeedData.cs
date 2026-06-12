using Kooch.Api.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Data;

public static class SeedData
{
    private const string AdminEmail = "admin@kooch.ir";
    private const string InitialAdminPassword = "Admin@123456";

    public static async Task InitializeAsync(KoochDbContext dbContext)
    {
        await SeedAdminAsync(dbContext);
        await SeedDestinationAsync(dbContext);
        await SeedTravelPurposesAsync(dbContext);
        await SeedAmenitiesAsync(dbContext);
        await SeedBedTypesAsync(dbContext);
        await SeedMealPlansAsync(dbContext);

        await dbContext.SaveChangesAsync();
    }

    private static async Task SeedAdminAsync(KoochDbContext dbContext)
    {
        if (await dbContext.Users.IgnoreQueryFilters().AnyAsync(user => user.Email == AdminEmail))
        {
            return;
        }

        var admin = new User
        {
            FirstName = "Kooch",
            LastName = "Admin",
            Email = AdminEmail,
            Role = UserRole.Admin,
            IsActive = true
        };

        admin.PasswordHash = new PasswordHasher<User>().HashPassword(admin, InitialAdminPassword);
        dbContext.Users.Add(admin);
    }

    private static async Task SeedDestinationAsync(KoochDbContext dbContext)
    {
        if (await dbContext.Destinations.IgnoreQueryFilters().AnyAsync(destination => destination.Slug == "kashan"))
        {
            return;
        }

        dbContext.Destinations.Add(new Destination
        {
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran",
            Latitude = 33.985m,
            Longitude = 51.410m
        });
    }

    private static async Task SeedTravelPurposesAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new TravelPurpose { Name = "Leisure", Slug = "leisure", Description = "Sightseeing, relaxation, and holidays." },
            new TravelPurpose { Name = "Business", Slug = "business", Description = "Business trips and professional travel." },
            new TravelPurpose { Name = "Family", Slug = "family", Description = "Trips with children or extended family." },
            new TravelPurpose { Name = "Romantic", Slug = "romantic", Description = "Couples and honeymoon travel." },
            new TravelPurpose { Name = "Cultural", Slug = "cultural", Description = "Heritage, architecture, and local culture." },
            new TravelPurpose { Name = "Adventure", Slug = "adventure", Description = "Outdoor activities and exploration." }
        };

        var existingSlugs = await dbContext.TravelPurposes.IgnoreQueryFilters()
            .Select(item => item.Slug)
            .ToListAsync();

        dbContext.TravelPurposes.AddRange(items.Where(item => !existingSlugs.Contains(item.Slug)));
    }

    private static async Task SeedAmenitiesAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new Amenity { Name = "Wi-Fi", Slug = "wifi", Description = "Wireless internet access.", Icon = "wifi", Scope = AmenityScope.Both },
            new Amenity { Name = "Parking", Slug = "parking", Description = "On-site or nearby parking.", Icon = "parking", Scope = AmenityScope.Property },
            new Amenity { Name = "Air Conditioning", Slug = "air-conditioning", Description = "Air-conditioned rooms.", Icon = "snowflake", Scope = AmenityScope.RoomType },
            new Amenity { Name = "Heating", Slug = "heating", Description = "Room heating is available.", Icon = "temperature-high", Scope = AmenityScope.RoomType },
            new Amenity { Name = "Private Bathroom", Slug = "private-bathroom", Description = "A private bathroom for the room.", Icon = "bath", Scope = AmenityScope.RoomType },
            new Amenity { Name = "Breakfast", Slug = "breakfast", Description = "Breakfast service is available.", Icon = "utensils", Scope = AmenityScope.Property },
            new Amenity { Name = "Restaurant", Slug = "restaurant", Description = "On-site restaurant or dining service.", Icon = "restaurant", Scope = AmenityScope.Property },
            new Amenity { Name = "24-hour Reception", Slug = "24-hour-reception", Description = "Reception service available around the clock.", Icon = "clock", Scope = AmenityScope.Property },
            new Amenity { Name = "Television", Slug = "television", Description = "Television in the room.", Icon = "tv", Scope = AmenityScope.RoomType },
            new Amenity { Name = "Refrigerator", Slug = "refrigerator", Description = "In-room refrigerator.", Icon = "refrigerator", Scope = AmenityScope.RoomType }
        };

        var existingSlugs = await dbContext.Amenities.IgnoreQueryFilters()
            .Select(item => item.Slug)
            .ToListAsync();

        dbContext.Amenities.AddRange(items.Where(item => !existingSlugs.Contains(item.Slug)));
    }

    private static async Task SeedBedTypesAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new BedType { Name = "Single Bed", Slug = "single-bed" },
            new BedType { Name = "Double Bed", Slug = "double-bed" },
            new BedType { Name = "Queen Bed", Slug = "queen-bed" },
            new BedType { Name = "King Bed", Slug = "king-bed" },
            new BedType { Name = "Twin Beds", Slug = "twin-beds" },
            new BedType { Name = "Sofa Bed", Slug = "sofa-bed" }
        };

        var existingSlugs = await dbContext.BedTypes.IgnoreQueryFilters()
            .Select(item => item.Slug)
            .ToListAsync();

        dbContext.BedTypes.AddRange(items.Where(item => !existingSlugs.Contains(item.Slug)));
    }

    private static async Task SeedMealPlansAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new MealPlan { Name = "Room Only", Slug = "room-only", Description = "Accommodation without meals." },
            new MealPlan { Name = "Breakfast Included", Slug = "breakfast-included", Description = "Breakfast is included in the rate." },
            new MealPlan { Name = "Half Board", Slug = "half-board", Description = "Breakfast and one main meal are included." },
            new MealPlan { Name = "Full Board", Slug = "full-board", Description = "Breakfast, lunch, and dinner are included." }
        };

        var existingSlugs = await dbContext.MealPlans.IgnoreQueryFilters()
            .Select(item => item.Slug)
            .ToListAsync();

        dbContext.MealPlans.AddRange(items.Where(item => !existingSlugs.Contains(item.Slug)));
    }
}
