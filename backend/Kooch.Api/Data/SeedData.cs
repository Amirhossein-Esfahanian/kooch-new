using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Data;

public static class SeedData
{
    private const string AdminEmail = "admin@kooch.local";
    private const string InitialAdminPassword = "Admin@12345";

    public static async Task InitializeAsync(KoochDbContext dbContext)
    {
        await SeedAdminAsync(dbContext);
        await SeedPermissionsAsync(dbContext);
        await SeedSiteSettingsAsync(dbContext);
        await SeedDestinationAsync(dbContext);
        await dbContext.SaveChangesAsync();
        await SeedDefaultNearbyPlacesAsync(dbContext);
        await SeedTravelPurposesAsync(dbContext);
        await SeedAmenityCategoriesAsync(dbContext);
        await dbContext.SaveChangesAsync();
        await SeedAmenitiesAsync(dbContext);
        await SeedBedTypesAsync(dbContext);
        await SeedMealPlansAsync(dbContext);

        await dbContext.SaveChangesAsync();
        await SeedDemoPropertiesAsync(dbContext);
        await dbContext.SaveChangesAsync();
    }

    private static async Task SeedAdminAsync(KoochDbContext dbContext)
    {
        var existingAdmin = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(user => user.Email == AdminEmail);

        if (existingAdmin is not null)
        {
            existingAdmin.Role = UserRole.SuperAdmin;
            existingAdmin.IsActive = true;
            existingAdmin.CanManageUsers = true;
            existingAdmin.CanBeRestricted = false;
            if (!existingAdmin.PasswordHash.StartsWith("$2", StringComparison.Ordinal))
            {
                existingAdmin.PasswordHash = BCrypt.Net.BCrypt.HashPassword(InitialAdminPassword);
            }
            return;
        }

        var admin = new User
        {
            FirstName = "Kooch",
            LastName = "Admin",
            Email = AdminEmail,
            Role = UserRole.SuperAdmin,
            IsActive = true,
            CanManageUsers = true,
            CanBeRestricted = false
        };

        admin.PasswordHash = BCrypt.Net.BCrypt.HashPassword(InitialAdminPassword);
        dbContext.Users.Add(admin);
    }

    private static async Task SeedPermissionsAsync(KoochDbContext dbContext)
    {
        var existingKeys = await dbContext.Permissions.IgnoreQueryFilters()
            .Select(permission => permission.Key)
            .ToListAsync();

        var permissions = Enum.GetValues<PermissionKey>()
            .Where(key => !existingKeys.Contains(key))
            .Select(key => new Permission
            {
                Key = key,
                Name = key.ToString()
            });

        dbContext.Permissions.AddRange(permissions);
    }

    private static async Task SeedSiteSettingsAsync(KoochDbContext dbContext)
    {
        var defaults = new[]
        {
            SiteSettingSeed("site.name", "کوچ", SiteSettingType.Text, "Brand", "نام سایت", null, 10),
            SiteSettingSeed("site.logoUrl", "", SiteSettingType.ImageUrl, "Brand", "آدرس لوگو", "اگر خالی باشد نام سایت نمایش داده می‌شود.", 20),
            SiteSettingSeed("site.footerText", "اقامتگاه‌های سنتی و میزبانی محلی در کاشان", SiteSettingType.Text, "Footer", "متن فوتر", null, 10),
            SiteSettingSeed("home.heroTitle", "اقامتگاه بعدی خود را پیدا کنید", SiteSettingType.Text, "Homepage", "عنوان هیرو", null, 10),
            SiteSettingSeed("home.heroSubtitle", "رزرو اقامتگاه‌های سنتی، بوتیک‌هتل‌ها و خانه‌های خاص", SiteSettingType.LongText, "Homepage", "زیرعنوان هیرو", null, 20),
            SiteSettingSeed("home.heroBackgroundUrl", "/images/hero.jpg", SiteSettingType.ImageUrl, "Homepage", "تصویر پس‌زمینه هیرو", null, 30),
            SiteSettingSeed("home.searchButtonText", "جستجوی اقامتگاه", SiteSettingType.Text, "Homepage", "متن دکمه جستجو", null, 40),
            SiteSettingSeed("home.popularSectionTitle", "اقامتگاه‌های محبوب", SiteSettingType.Text, "Homepage", "عنوان بخش محبوب", null, 50),
            SiteSettingSeed("home.popularSectionSubtitle", "اقامتگاه‌های منتخب برای سفر بعدی شما", SiteSettingType.LongText, "Homepage", "زیرعنوان بخش محبوب", null, 60),
            SiteSettingSeed("site.defaultSeoTitle", "کوچ | رزرو اقامتگاه سنتی", SiteSettingType.Text, "SEO", "عنوان پیش‌فرض سئو", null, 10),
            SiteSettingSeed("site.defaultSeoDescription", "رزرو اقامتگاه‌های سنتی، بوتیک‌هتل‌ها و خانه‌های خاص", SiteSettingType.LongText, "SEO", "توضیحات پیش‌فرض سئو", null, 20),
            SiteSettingSeed("image.maxFileSizeMb", "2", SiteSettingType.Number, "Images", "حداکثر حجم هر تصویر (مگابایت)", "تصاویر بزرگ‌تر پیش از بارگذاری رد می‌شوند.", 10),
            SiteSettingSeed("image.minWidth", "800", SiteSettingType.Number, "Images", "حداقل عرض تصویر (پیکسل)", null, 20),
            SiteSettingSeed("image.minHeight", "600", SiteSettingType.Number, "Images", "حداقل ارتفاع تصویر (پیکسل)", null, 30),
            SiteSettingSeed("image.maxImagesPerProperty", "30", SiteSettingType.Number, "Images", "حداکثر تصاویر هر اقامتگاه", "مجموع تصاویر اقامتگاه و اتاق‌های آن.", 40),
            SiteSettingSeed("image.enableWebpConversion", "true", SiteSettingType.Boolean, "Images", "تبدیل خودکار به WebP", "نسخه ذخیره‌شده تصاویر را برای کاهش حجم به WebP تبدیل می‌کند.", 50)
        };

        var existing = await dbContext.SiteSettings.IgnoreQueryFilters().ToListAsync();
        foreach (var item in defaults)
        {
            var setting = existing.SingleOrDefault(existingSetting => existingSetting.Key == item.Key);
            if (setting is null)
            {
                dbContext.SiteSettings.Add(new SiteSetting
                {
                    Key = item.Key,
                    Value = item.Value,
                    Type = item.Type,
                    Group = item.Group,
                    Label = item.Label,
                    Description = item.Description,
                    SortOrder = item.SortOrder,
                    IsActive = true
                });
                continue;
            }

            setting.Type = item.Type;
            setting.Group = item.Group;
            setting.Label = item.Label;
            setting.Description = item.Description;
            setting.SortOrder = item.SortOrder;
            setting.IsActive = true;
            setting.IsDeleted = false;
            setting.DeletedAtUtc = null;
            setting.DeletedByUserId = null;
        }
    }

    private static SiteSettingSeedItem SiteSettingSeed(
        string key,
        string value,
        SiteSettingType type,
        string group,
        string label,
        string? description,
        int sortOrder) =>
        new(key, value, type, group, label, description, sortOrder);

    private sealed record SiteSettingSeedItem(
        string Key,
        string Value,
        SiteSettingType Type,
        string Group,
        string Label,
        string? Description,
        int SortOrder);

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

    private static async Task SeedDefaultNearbyPlacesAsync(KoochDbContext dbContext)
    {
        var destinationId = await dbContext.Destinations
            .Where(destination => destination.Slug == "kashan")
            .Select(destination => (int?)destination.Id)
            .SingleOrDefaultAsync();

        if (destinationId is null)
        {
            return;
        }

        var items = new[]
        {
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Railway Station", Category = NearbyPlaceCategory.Transport },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Bus Terminal", Category = NearbyPlaceCategory.Transport },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Airport", Category = NearbyPlaceCategory.Transport },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "City Center", Category = NearbyPlaceCategory.Landmark },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Hospital", Category = NearbyPlaceCategory.Other },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Fin Garden", Category = NearbyPlaceCategory.Attraction },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Kashan Bazaar", Category = NearbyPlaceCategory.Market },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Tabatabaei House", Category = NearbyPlaceCategory.Attraction },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Borujerdi House", Category = NearbyPlaceCategory.Attraction },
            new DefaultNearbyPlace { DestinationId = destinationId.Value, Title = "Kamal-ol-Molk Square", Category = NearbyPlaceCategory.Landmark }
        };

        var existingTitles = await dbContext.DefaultNearbyPlaces.IgnoreQueryFilters()
            .Where(place => place.DestinationId == destinationId.Value)
            .Select(place => place.Title)
            .ToListAsync();

        dbContext.DefaultNearbyPlaces.AddRange(items.Where(item => !existingTitles.Contains(item.Title)));
    }

    private static async Task SeedAmenityCategoriesAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new AmenityCategory { Name = "Base Services", Slug = "base-services", SortOrder = 10, Icon = "utilities" },
            new AmenityCategory { Name = "Health & Bathroom", Slug = "health-bathroom", SortOrder = 20, Icon = "bath" },
            new AmenityCategory { Name = "Kitchen", Slug = "kitchen", SortOrder = 30, Icon = "kitchen" },
            new AmenityCategory { Name = "Comfort & Welfare", Slug = "comfort-welfare", SortOrder = 40, Icon = "sofa" },
            new AmenityCategory { Name = "Entertainment", Slug = "entertainment", SortOrder = 50, Icon = "gamepad" },
            new AmenityCategory { Name = "Safety", Slug = "safety", SortOrder = 60, Icon = "shield" },
            new AmenityCategory { Name = "Environment", Slug = "environment", SortOrder = 70, Icon = "garden" },
            new AmenityCategory { Name = "Exclusive Features", Slug = "exclusive-features", SortOrder = 80, Icon = "star" }
        };

        var existing = await dbContext.AmenityCategories.IgnoreQueryFilters().ToListAsync();
        foreach (var item in items)
        {
            var category = existing.SingleOrDefault(category => category.Slug == item.Slug);
            if (category is null)
            {
                dbContext.AmenityCategories.Add(item);
                continue;
            }

            category.Name = item.Name;
            category.SortOrder = item.SortOrder;
            category.Icon = item.Icon;
            category.IsActive = true;
            category.IsDeleted = false;
            category.DeletedAtUtc = null;
            category.DeletedByUserId = null;
        }
    }

    private static async Task SeedAmenitiesAsync(KoochDbContext dbContext)
    {
        var categories = await dbContext.AmenityCategories
            .ToDictionaryAsync(category => category.Slug, category => category.Id);

        var items = new[]
        {
            AmenitySeed("Water", "water", "base-services", 10, AmenityScope.Property),
            AmenitySeed("Electricity", "electricity", "base-services", 20, AmenityScope.Property),
            AmenitySeed("Gas", "gas", "base-services", 30, AmenityScope.Property),
            AmenitySeed("Mobile Coverage", "mobile-coverage", "base-services", 40, AmenityScope.Property),
            AmenitySeed("WiFi", "wifi", "base-services", 50, AmenityScope.Both, "Wireless internet access."),
            AmenitySeed("Private Bathroom", "private-bathroom", "health-bathroom", 10, AmenityScope.RoomType),
            AmenitySeed("Shared Bathroom", "shared-bathroom", "health-bathroom", 20, AmenityScope.RoomType),
            AmenitySeed("Shower", "shower", "health-bathroom", 30, AmenityScope.RoomType),
            AmenitySeed("Western Toilet", "western-toilet", "health-bathroom", 40, AmenityScope.Both),
            AmenitySeed("Iranian Toilet", "iranian-toilet", "health-bathroom", 50, AmenityScope.Both),
            AmenitySeed("Refrigerator", "refrigerator", "kitchen", 10, AmenityScope.Both),
            AmenitySeed("Stove", "stove", "kitchen", 20, AmenityScope.Both),
            AmenitySeed("Microwave", "microwave", "kitchen", 30, AmenityScope.Both),
            AmenitySeed("Cooking Utensils", "cooking-utensils", "kitchen", 40, AmenityScope.Both),
            AmenitySeed("Air Conditioner", "air-conditioner", "comfort-welfare", 10, AmenityScope.RoomType),
            AmenitySeed("Heater", "heater", "comfort-welfare", 20, AmenityScope.RoomType),
            AmenitySeed("Furniture", "furniture", "comfort-welfare", 30, AmenityScope.Both),
            AmenitySeed("TV", "tv", "comfort-welfare", 40, AmenityScope.RoomType),
            AmenitySeed("Game Console", "game-console", "entertainment", 10, AmenityScope.RoomType),
            AmenitySeed("Board Games", "board-games", "entertainment", 20, AmenityScope.Both),
            AmenitySeed("Fire Extinguisher", "fire-extinguisher", "safety", 10, AmenityScope.Both),
            AmenitySeed("First Aid Kit", "first-aid-kit", "safety", 20, AmenityScope.Both),
            AmenitySeed("Garden", "garden", "environment", 10, AmenityScope.Property),
            AmenitySeed("Courtyard", "courtyard", "environment", 20, AmenityScope.Property),
            AmenitySeed("Rooftop", "rooftop", "environment", 30, AmenityScope.Property),
            AmenitySeed("Traditional Architecture", "traditional-architecture", "exclusive-features", 10, AmenityScope.Property),
            AmenitySeed("Historic Building", "historic-building", "exclusive-features", 20, AmenityScope.Property)
        };

        var existing = await dbContext.Amenities.IgnoreQueryFilters().ToListAsync();
        foreach (var item in items)
        {
            var amenity = existing.SingleOrDefault(existingAmenity => existingAmenity.Slug == item.Slug);
            if (amenity is null)
            {
                dbContext.Amenities.Add(new Amenity
                {
                    AmenityCategoryId = categories[item.CategorySlug],
                    Name = item.Name,
                    Slug = item.Slug,
                    Description = item.Description,
                    Scope = item.Scope,
                    SortOrder = item.SortOrder
                });
                continue;
            }

            amenity.AmenityCategoryId = categories[item.CategorySlug];
            amenity.Name = item.Name;
            amenity.Description = item.Description ?? amenity.Description;
            amenity.Scope = item.Scope;
            amenity.SortOrder = item.SortOrder;
            amenity.IsDeleted = false;
            amenity.DeletedAtUtc = null;
            amenity.DeletedByUserId = null;
        }
    }

    private static AmenitySeedItem AmenitySeed(
        string name,
        string slug,
        string categorySlug,
        int sortOrder,
        AmenityScope scope,
        string? description = null) =>
        new(name, slug, categorySlug, sortOrder, scope, description);

    private sealed record AmenitySeedItem(
        string Name,
        string Slug,
        string CategorySlug,
        int SortOrder,
        AmenityScope Scope,
        string? Description);

    private static async Task SeedBedTypesAsync(KoochDbContext dbContext)
    {
        var items = new[]
        {
            new BedType { Name = "Single Bed", Slug = "single-bed" },
            new BedType { Name = "Double Bed", Slug = "double-bed" },
            new BedType { Name = "Queen Bed", Slug = "queen-bed" },
            new BedType { Name = "King Bed", Slug = "king-bed" },
            new BedType { Name = "Twin Beds", Slug = "twin-beds" },
            new BedType { Name = "Sofa Bed", Slug = "sofa-bed" },
            new BedType { Name = "Traditional Floor Bedding", Slug = "traditional-floor-bedding" }
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

    private static async Task SeedDemoPropertiesAsync(KoochDbContext dbContext)
    {
        if (await dbContext.Properties.IgnoreQueryFilters().AnyAsync())
        {
            return;
        }

        var ownerId = await dbContext.Users
            .Where(user => user.Email == AdminEmail)
            .Select(user => user.Id)
            .SingleAsync();
        var destinationId = await dbContext.Destinations
            .Where(destination => destination.Slug == "kashan")
            .Select(destination => destination.Id)
            .SingleAsync();

        var courtyardHouse = new Property
        {
            OwnerId = ownerId,
            DestinationId = destinationId,
            Name = "Kashan Courtyard House",
            Slug = "kashan-courtyard-house",
            Description = "A simple traditional stay around a quiet central courtyard in Kashan.",
            Address = "Historic Center, Kashan",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms,
            CheckInTime = new TimeOnly(14, 0),
            CheckOutTime = new TimeOnly(11, 0)
        };
        var gardenHotel = new Property
        {
            OwnerId = ownerId,
            DestinationId = destinationId,
            Name = "Fin Garden Boutique Stay",
            Slug = "fin-garden-boutique-stay",
            Description = "A small Kashan stay with straightforward room-type inventory for demo purposes.",
            Address = "Fin Road, Kashan",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.BoutiqueHotel,
            InventoryMode = InventoryMode.TypeBasedInventory,
            CheckInTime = new TimeOnly(14, 0),
            CheckOutTime = new TimeOnly(11, 0)
        };

        dbContext.Properties.AddRange(courtyardHouse, gardenHotel);
        await dbContext.SaveChangesAsync();

        var shahAbbasi = new RoomType
        {
            PropertyId = courtyardHouse.Id,
            Name = "Shah Abbasi",
            Slug = "shah-abbasi",
            Description = "A unique named room facing the courtyard.",
            MaxAdults = 2,
            MaxChildren = 1,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
            BasePrice = 3200000m
        };
        var toranj = new RoomType
        {
            PropertyId = courtyardHouse.Id,
            Name = "Toranj",
            Slug = "toranj",
            Description = "A compact traditional named room.",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
            BasePrice = 2800000m
        };
        var doubleRoom = new RoomType
        {
            PropertyId = gardenHotel.Id,
            Name = "Double Room",
            Slug = "double-room",
            Description = "A standard double room sold from shared type inventory.",
            MaxAdults = 2,
            MaxChildren = 1,
            TotalInventory = 4,
            InventoryMode = InventoryMode.TypeBasedInventory,
            BasePrice = 2400000m
        };

        dbContext.RoomTypes.AddRange(shahAbbasi, toranj, doubleRoom);
        await dbContext.SaveChangesAsync();

        dbContext.Rooms.AddRange(
            new Room { RoomTypeId = shahAbbasi.Id, Name = "Shah Abbasi", Description = "Courtyard-facing named room." },
            new Room { RoomTypeId = toranj.Id, Name = "Toranj", Description = "Traditional named room." });
        dbContext.PropertyImages.AddRange(
            new PropertyImage
            {
                PropertyId = courtyardHouse.Id,
                Url = "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=80",
                AltText = "Traditional courtyard house",
                IsCover = true,
                IsGallery = true,
                SortOrder = 1
            },
            new PropertyImage
            {
                PropertyId = courtyardHouse.Id,
                Url = "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=80",
                AltText = "Traditional room interior",
                IsGallery = true,
                SortOrder = 2
            },
            new PropertyImage
            {
                PropertyId = gardenHotel.Id,
                Url = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=80",
                AltText = "Boutique hotel exterior",
                IsCover = true,
                IsGallery = true,
                SortOrder = 1
            });
        dbContext.PropertyCommonAreas.AddRange(
            new PropertyCommonArea { PropertyId = courtyardHouse.Id, Name = "Central Courtyard", SortOrder = 0 },
            new PropertyCommonArea { PropertyId = courtyardHouse.Id, Name = "Rooftop", SortOrder = 1 });
        dbContext.PropertyViews.AddRange(
            new PropertyView { PropertyId = courtyardHouse.Id, ViewType = PropertyViewType.CourtyardView },
            new PropertyView { PropertyId = gardenHotel.Id, ViewType = PropertyViewType.GardenView });
        dbContext.Availabilities.Add(new Availability
        {
            RoomTypeId = shahAbbasi.Id,
            Date = DateOnly.FromDateTime(DateTime.UtcNow.Date),
            Price = 3000000m,
            OriginalPrice = 3200000m,
            AvailableCount = 1,
            Status = AvailabilityStatus.Available
        });
    }
}
