using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IPermissionService permissionService) : IPropertyService
{
    public async Task<PropertyResponse> CreatePropertyAsync(
        int userId,
        UserRole role,
        CreatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        if (role is not UserRole.Owner and not UserRole.SuperAdmin)
        {
            throw new UnauthorizedAccessException("Only owners and SuperAdmin can create properties.");
        }

        var ownerId = role == UserRole.SuperAdmin ? request.OwnerId ?? userId : userId;
        if (!await dbContext.Users.AsNoTracking().AnyAsync(user =>
                user.Id == ownerId && user.IsActive &&
                (user.Role == UserRole.Owner || user.Role == UserRole.SuperAdmin), cancellationToken))
        {
            throw new ArgumentException("The selected owner is invalid.");
        }

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.Create(englishName, "property");
        await EnsureUniqueSlugAsync(slug, null, cancellationToken);

        var property = new Property
        {
            OwnerId = ownerId,
            DestinationId = request.DestinationId,
            Name = request.Name.Trim(),
            EnglishName = englishName,
            Slug = slug,
            Description = request.Description.Trim(),
            SeoTitle = CleanOptional(request.SeoTitle),
            SeoDescription = CleanOptional(request.SeoDescription),
            Address = request.Address.Trim(),
            City = request.City.Trim(),
            Country = request.Country.Trim(),
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            Type = request.Type,
            InventoryMode = request.InventoryMode,
            CheckInTime = request.CheckInTime,
            CheckOutTime = request.CheckOutTime,
            HasElevator = request.HasElevator,
            IsWheelchairAccessible = request.IsWheelchairAccessible,
            HasGroundFloorRoom = request.HasGroundFloorRoom,
            HasAccessibleBathroom = request.HasAccessibleBathroom,
            FreeChildAgeLimit = request.FreeChildAgeLimit,
            MaxFreeChildren = request.MaxFreeChildren,
            Status = role == UserRole.SuperAdmin
                ? request.Status ?? PropertyStatus.PendingReview
                : PropertyStatus.PendingReview
        };

        dbContext.Properties.Add(property);
        await dbContext.SaveChangesAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(englishName))
        {
            property.Slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id);
            await EnsureUniqueSlugAsync(property.Slug, property.Id, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        return await LoadResponseAsync(property.Id, cancellationToken);
    }

    public async Task<PropertyResponse> UpdatePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        UpdatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (!await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage this property.");
        }

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = request.EnglishName is null
            ? property.EnglishName
            : CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id, property.Slug);
        await EnsureUniqueSlugAsync(slug, propertyId, cancellationToken);

        property.DestinationId = request.DestinationId;
        property.Name = request.Name.Trim();
        property.EnglishName = englishName;
        property.Slug = slug;
        property.Description = request.Description.Trim();
        property.SeoTitle = CleanOptional(request.SeoTitle);
        property.SeoDescription = CleanOptional(request.SeoDescription);
        property.Address = request.Address.Trim();
        property.City = request.City.Trim();
        property.Country = request.Country.Trim();
        property.Latitude = request.Latitude;
        property.Longitude = request.Longitude;
        property.Type = request.Type;
        property.InventoryMode = request.InventoryMode;
        property.CheckInTime = request.CheckInTime;
        property.CheckOutTime = request.CheckOutTime;
        property.TotalAreaM2 = request.TotalAreaM2;
        property.LandAreaM2 = request.LandAreaM2;
        property.FloorsCount = request.FloorsCount;
        property.StairCount = request.StairCount;
        property.HasElevator = request.HasElevator;
        property.IsWheelchairAccessible = request.IsWheelchairAccessible;
        property.HasGroundFloorRoom = request.HasGroundFloorRoom;
        property.HasAccessibleBathroom = request.HasAccessibleBathroom;
        property.FreeChildAgeLimit = request.FreeChildAgeLimit;
        property.MaxFreeChildren = request.MaxFreeChildren;

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(property.Id, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyResponse>> GetMyPropertiesAsync(
        int userId,
        UserRole role,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.Properties.AsNoTracking();

        query = role switch
        {
            UserRole.SuperAdmin => query,
            UserRole.Owner => query.Where(property => property.OwnerId == userId),
            UserRole.OwnerAssistant => query.Where(property => property.UserPropertyAccesses
                .Any(access => access.UserId == userId && access.IsActive)),
            UserRole.AdminAssistant => await HasGlobalManagePermissionAsync(userId, cancellationToken)
                ? query
                : query.Where(property => property.UserPermissions.Any(permission =>
                    permission.UserId == userId &&
                    permission.PermissionKey == PermissionKey.ManageProperties &&
                    permission.IsAllowed)),
            _ => query.Where(property => false)
        };

        return await Project(query.OrderBy(property => property.Name)).ToListAsync(cancellationToken);
    }

    public async Task<PropertyResponse> UpdatePropertyForAdminAsync(
        int userId,
        UserRole role,
        int propertyId,
        AdminUpdatePropertyRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanAdminManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var property = await GetEntityAsync(propertyId, cancellationToken);
        if (!await dbContext.Users.AsNoTracking().AnyAsync(user =>
                user.Id == request.OwnerId &&
                user.IsActive &&
                (user.Role == UserRole.Owner || user.Role == UserRole.SuperAdmin),
                cancellationToken))
        {
            throw new ArgumentException("The selected owner is invalid.");
        }

        await ValidateDestinationAsync(request.DestinationId, cancellationToken);
        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "property", property.Id, property.Slug);
        await EnsureUniqueSlugAsync(slug, propertyId, cancellationToken);

        property.OwnerId = request.OwnerId;
        property.DestinationId = request.DestinationId;
        property.Name = request.Name.Trim();
        property.EnglishName = englishName;
        property.Slug = slug;
        property.Description = request.Description.Trim();
        property.SeoTitle = CleanOptional(request.SeoTitle);
        property.SeoDescription = CleanOptional(request.SeoDescription);
        property.Address = request.Address.Trim();
        property.City = request.City.Trim();
        property.Country = request.Country.Trim();
        property.Status = request.Status;
        property.Type = request.Type;
        property.InventoryMode = request.InventoryMode;
        property.CheckInTime = request.CheckInTime;
        property.CheckOutTime = request.CheckOutTime;
        property.Latitude = request.Latitude;
        property.Longitude = request.Longitude;
        property.TotalAreaM2 = request.TotalAreaM2;
        property.LandAreaM2 = request.LandAreaM2;
        property.FloorsCount = request.FloorsCount;
        property.HasElevator = request.HasElevator;
        property.IsWheelchairAccessible = request.IsWheelchairAccessible;
        property.HasGroundFloorRoom = request.HasGroundFloorRoom;
        property.HasAccessibleBathroom = request.HasAccessibleBathroom;
        property.FreeChildAgeLimit = request.FreeChildAgeLimit;
        property.MaxFreeChildren = request.MaxFreeChildren;

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyResponse> GetPropertyByIdAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (!await dbContext.Properties.AsNoTracking().AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyResponse>> GetAllForAdminAsync(
        int userId,
        UserRole role,
        CancellationToken cancellationToken = default)
    {
        var allowed = role == UserRole.SuperAdmin ||
                      role == UserRole.AdminAssistant &&
                      await HasGlobalManagePermissionAsync(userId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageProperties permission is required.");
        }

        return await Project(dbContext.Properties.AsNoTracking().OrderBy(property => property.Name))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PublicPropertyResponse>> GetPublicPropertiesAsync(
        string? q = null,
        string? city = null,
        DateOnly? checkIn = null,
        DateOnly? checkOut = null,
        int? rooms = null,
        int? adults = null,
        int? children = null,
        string? childAges = null,
        CancellationToken cancellationToken = default)
    {
        var minAdults = Math.Max(0, adults ?? 0);
        var requestedChildren = Math.Max(0, children ?? 0);
        var parsedChildAges = ParseChildAges(childAges, requestedChildren);
        var hasGuestFilter = minAdults > 0 || requestedChildren > 0 || rooms.HasValue;

        var query = dbContext.Properties.AsNoTracking()
            .Where(property => property.Status == PropertyStatus.Approved);

        var normalizedCity = string.IsNullOrWhiteSpace(city) ? "Kashan" : city.Trim();
        query = query.Where(property => property.City.Contains(normalizedCity));

        if (!string.IsNullOrWhiteSpace(q))
        {
            var normalizedQuery = q.Trim();
            query = query.Where(property =>
                property.Name.Contains(normalizedQuery) ||
                (property.EnglishName != null && property.EnglishName.Contains(normalizedQuery)) ||
                property.Slug.Contains(normalizedQuery) ||
                property.Description.Contains(normalizedQuery) ||
                property.City.Contains(normalizedQuery));
        }

        if (hasGuestFilter)
        {
            query = query.Where(property => property.RoomTypes.Any(roomType =>
                roomType.IsActive &&
                roomType.TotalInventory > 0 &&
                roomType.MaxAdults >= minAdults &&
                roomType.MaxChildren >= 0));
        }

        var properties = await ProjectPublic(query.OrderBy(property => property.Name), minAdults, 0)
            .ToListAsync(cancellationToken);

        foreach (var property in properties)
        {
            var effectiveChildren = CountCapacityChildren(parsedChildAges, requestedChildren, property.FreeChildAgeLimit, property.MaxFreeChildren);
            var matchingRoomTypes = property.RoomTypes
                .Where(roomType =>
                    roomType.TotalInventory > 0 &&
                    roomType.MaxAdults >= minAdults &&
                    roomType.MaxChildren >= effectiveChildren)
                .Select(roomType => new PublicRoomTypeSummaryResponse
                {
                    Id = roomType.Id,
                    Name = roomType.Name,
                    MaxAdults = roomType.MaxAdults,
                    MaxChildren = roomType.MaxChildren,
                    TotalInventory = roomType.TotalInventory,
                    DisplayPrice = roomType.DisplayPrice
                })
                .ToList();

            property.MatchingRoomTypes = matchingRoomTypes;
            property.MatchingRoomTypesCount = matchingRoomTypes.Count;
            property.GuestFitStatus = matchingRoomTypes.Count > 0 ? "مناسب ظرفیت" : property.RoomTypes.Count == 0 ? "ظرفیت نامشخص" : "نامناسب";
            property.AvailabilitySummary = "فعلاً همه موجود فرض شده‌اند";
            property.AvailabilityStatusSummary = matchingRoomTypes.Count > 0 ? "Available" : "Unknown";
        }

        return hasGuestFilter
            ? properties.Where(property => property.MatchingRoomTypesCount > 0).ToList()
            : properties;
    }

    public async Task<IReadOnlyList<PublicPropertySuggestionResponse>> GetPublicPropertySuggestionsAsync(
        string? q = null,
        string? city = null,
        CancellationToken cancellationToken = default)
    {
        var normalizedCity = string.IsNullOrWhiteSpace(city) ? "Kashan" : city.Trim();
        var query = dbContext.Properties.AsNoTracking()
            .Where(property => property.Status == PropertyStatus.Approved && property.City.Contains(normalizedCity));

        if (!string.IsNullOrWhiteSpace(q))
        {
            var normalizedQuery = q.Trim();
            query = query.Where(property =>
                property.Name.Contains(normalizedQuery) ||
                (property.EnglishName != null && property.EnglishName.Contains(normalizedQuery)) ||
                property.Slug.Contains(normalizedQuery) ||
                property.Description.Contains(normalizedQuery) ||
                property.City.Contains(normalizedQuery));
        }

        return await query
            .OrderBy(property => property.Name)
            .Take(8)
            .Select(property => new PublicPropertySuggestionResponse
            {
                Id = property.Id,
                Name = property.Name,
                EnglishName = property.EnglishName,
                Slug = property.Slug,
                City = property.City
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PublicPropertyResponse?> GetPublicPropertyBySlugAsync(
        string slug,
        CancellationToken cancellationToken = default)
    {
        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        return await ProjectPublic(dbContext.Properties.AsNoTracking()
                .Where(property => property.Status == PropertyStatus.Approved && property.Slug == normalizedSlug))
            .SingleOrDefaultAsync(cancellationToken);
    }

    public Task<PropertyResponse> ApprovePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Approved, cancellationToken);

    public Task<PropertyResponse> RejectPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Rejected, cancellationToken);

    public Task<PropertyResponse> SuspendPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, PropertyStatus.Suspended, cancellationToken);

    public Task<PropertyResponse> SetPropertyStatusAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyStatus status,
        CancellationToken cancellationToken = default) =>
        SetStatusAsync(userId, role, propertyId, status, cancellationToken);

    private async Task<PropertyResponse> SetStatusAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyStatus status,
        CancellationToken cancellationToken)
    {
        await EnsureCanAdminManagePropertyAsync(userId, role, propertyId, cancellationToken);

        var property = await GetEntityAsync(propertyId, cancellationToken);
        property.Status = status;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(propertyId, cancellationToken);
    }

    private async Task<Property> GetEntityAsync(int propertyId, CancellationToken cancellationToken) =>
        await dbContext.Properties.SingleOrDefaultAsync(property => property.Id == propertyId, cancellationToken)
        ?? throw new KeyNotFoundException("Property not found.");

    private async Task EnsureCanAdminManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var allowed = role == UserRole.SuperAdmin ||
                      role == UserRole.AdminAssistant &&
                      await permissionService.HasPermissionAsync(
                          userId, PermissionKey.ManageProperties, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageProperties permission is required.");
        }
    }

    private async Task<PropertyResponse> LoadResponseAsync(int propertyId, CancellationToken cancellationToken) =>
        await Project(dbContext.Properties.AsNoTracking().Where(property => property.Id == propertyId))
            .SingleAsync(cancellationToken);

    private async Task<bool> HasGlobalManagePermissionAsync(int userId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(userId, PermissionKey.ManageProperties, null, cancellationToken);

    private async Task ValidateDestinationAsync(int destinationId, CancellationToken cancellationToken)
    {
        if (!await dbContext.Destinations.AsNoTracking()
                .AnyAsync(destination => destination.Id == destinationId, cancellationToken))
        {
            throw new ArgumentException("Destination not found.");
        }
    }

    private async Task EnsureUniqueSlugAsync(string slug, int? propertyId, CancellationToken cancellationToken)
    {
        if (await dbContext.Properties.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(property => property.Slug == slug && property.Id != propertyId, cancellationToken))
        {
            throw new InvalidOperationException("A property with this slug already exists.");
        }
    }

    private static IQueryable<PropertyResponse> Project(IQueryable<Property> query) =>
        query.Select(property => new PropertyResponse
        {
            Id = property.Id,
            OwnerId = property.OwnerId,
            OwnerName = (property.Owner.FirstName + " " + property.Owner.LastName).Trim(),
            OwnerEmail = property.Owner.Email,
            CreatedAtUtc = property.CreatedAtUtc,
            DestinationId = property.DestinationId,
            DestinationName = property.Destination.Name,
            Name = property.Name,
            EnglishName = property.EnglishName,
            Slug = property.Slug,
            Description = property.Description,
            SeoTitle = property.SeoTitle,
            SeoDescription = property.SeoDescription,
            Address = property.Address,
            City = property.City,
            Country = property.Country,
            Latitude = property.Latitude,
            Longitude = property.Longitude,
            Status = property.Status,
            Type = property.Type,
            InventoryMode = property.InventoryMode,
            CheckInTime = property.CheckInTime,
            CheckOutTime = property.CheckOutTime,
            TotalAreaM2 = property.TotalAreaM2,
            LandAreaM2 = property.LandAreaM2,
            FloorsCount = property.FloorsCount,
            StairCount = property.StairCount,
            HasElevator = property.HasElevator,
            IsWheelchairAccessible = property.IsWheelchairAccessible,
            HasGroundFloorRoom = property.HasGroundFloorRoom,
            HasAccessibleBathroom = property.HasAccessibleBathroom,
            FreeChildAgeLimit = property.FreeChildAgeLimit,
            MaxFreeChildren = property.MaxFreeChildren,
        });

    private static IQueryable<PublicPropertyResponse> ProjectPublic(
        IQueryable<Property> query,
        int minAdults = 0,
        int minChildren = 0,
        bool hasDates = false,
        DateOnly? rangeStartValue = null,
        DateOnly? rangeEndExclusiveValue = null,
        int nights = 1)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var rangeStart = rangeStartValue ?? today;
        var rangeEndExclusive = rangeEndExclusiveValue ?? today.AddDays(1);
        return query.Select(property => new PublicPropertyResponse
        {
            Id = property.Id,
            Name = property.Name,
            EnglishName = property.EnglishName,
            Slug = property.Slug,
            SeoTitle = property.SeoTitle,
            SeoDescription = property.SeoDescription,
            City = property.City,
            Country = property.Country,
            Address = property.Address,
            Description = property.Description,
            ShortDescription = property.Description.Length > 180
                ? property.Description.Substring(0, 180) + "..."
                : property.Description,
            Status = property.Status,
            PropertyType = property.Type,
            InventoryMode = property.InventoryMode,
            CheckInTime = property.CheckInTime,
            CheckOutTime = property.CheckOutTime,
            Latitude = property.Latitude,
            Longitude = property.Longitude,
            HasElevator = property.HasElevator,
            IsWheelchairAccessible = property.IsWheelchairAccessible,
            HasGroundFloorRoom = property.HasGroundFloorRoom,
            HasAccessibleBathroom = property.HasAccessibleBathroom,
            FreeChildAgeLimit = property.FreeChildAgeLimit,
            MaxFreeChildren = property.MaxFreeChildren,
            IsInstantBooking = property.RoomTypes.Any(roomType => roomType.Availability.Any(
                availability => availability.Date >= today &&
                                availability.Status == AvailabilityStatus.Available &&
                                availability.AvailableCount > 0)),
            MatchingRoomTypesCount = property.RoomTypes.Count(roomType =>
                roomType.IsActive &&
                roomType.MaxAdults >= minAdults &&
                roomType.MaxChildren >= minChildren &&
                (!hasDates ||
                 !roomType.Availability.Any(availability =>
                     availability.Date >= rangeStart &&
                     availability.Date < rangeEndExclusive) ||
                 roomType.Availability.Count(availability =>
                     availability.Date >= rangeStart &&
                     availability.Date < rangeEndExclusive &&
                     availability.Status == AvailabilityStatus.Available &&
                     availability.AvailableCount > 0) == nights)),
            AvailabilityStatusSummary = hasDates
                ? property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    roomType.MaxAdults >= minAdults &&
                    roomType.MaxChildren >= minChildren &&
                    roomType.Availability.Count(availability =>
                        availability.Date >= rangeStart &&
                        availability.Date < rangeEndExclusive &&
                        availability.Status == AvailabilityStatus.Available &&
                        availability.AvailableCount > 0) == nights)
                    ? "Available"
                    : property.RoomTypes.Any(roomType =>
                        roomType.IsActive &&
                        roomType.MaxAdults >= minAdults &&
                        roomType.MaxChildren >= minChildren &&
                        roomType.Availability.Any(availability =>
                            availability.Date >= rangeStart &&
                            availability.Date < rangeEndExclusive &&
                            availability.Status == AvailabilityStatus.OnRequest))
                        ? "OnRequest"
                        : "Unknown"
                : property.RoomTypes.Any(roomType => roomType.IsActive && roomType.Availability.Any(availability =>
                    availability.Date >= today &&
                    availability.Status == AvailabilityStatus.Available &&
                    availability.AvailableCount > 0))
                    ? "Available"
                    : property.RoomTypes.Any(roomType => roomType.IsActive && roomType.Availability.Any(availability =>
                        availability.Date >= today &&
                        availability.Status == AvailabilityStatus.OnRequest))
                        ? "OnRequest"
                        : "Unknown",
            CoverImageUrl = property.Images
                .Where(image => image.RoomTypeId == null && image.RoomId == null)
                .OrderByDescending(image => image.IsCover)
                .ThenBy(image => image.SortOrder)
                .Select(image => image.Url)
                .FirstOrDefault(),
            StartingPrice = property.RoomTypes
                .Where(roomType => roomType.IsActive)
                .Select(roomType => roomType.Availability
                    .Where(availability => availability.Date >= today &&
                                           availability.Status != AvailabilityStatus.Unavailable)
                    .OrderBy(availability => availability.Date)
                    .Select(availability => (decimal?)availability.Price)
                    .FirstOrDefault() ?? roomType.BasePrice)
                .Where(price => price != null)
                .Min(),
            Images = property.Images
                .Where(image => image.RoomTypeId == null &&
                                image.RoomId == null &&
                                (image.IsGallery || image.IsCover))
                .OrderByDescending(image => image.IsCover)
                .ThenBy(image => image.SortOrder)
                .Select(image => new PublicImageResponse
                {
                    Id = image.Id,
                    Url = image.Url,
                    AltText = image.AltText,
                    Caption = image.Caption,
                    Tag = image.Tag,
                    IsCover = image.IsCover
                })
                .ToList(),
            DescriptionSections = property.DescriptionSections
                .OrderBy(section => section.SortOrder)
                .Select(section => new PublicDescriptionSectionResponse
                {
                    SectionType = section.SectionType,
                    Title = section.Title,
                    Content = section.Content,
                    SortOrder = section.SortOrder
                })
                .ToList(),
            CommonAreas = property.CommonAreas
                .OrderBy(area => area.SortOrder)
                .ThenBy(area => area.Name)
                .Select(area => new PublicCommonAreaResponse
                {
                    Id = area.Id,
                    Name = area.Name,
                    Description = area.Description,
                    SortOrder = area.SortOrder
                })
                .ToList(),
            Amenities = property.PropertyAmenities
                .OrderBy(join => join.Amenity.AmenityCategory.SortOrder)
                .ThenBy(join => join.Amenity.SortOrder)
                .Select(join => new PublicAmenityResponse
                {
                    Id = join.AmenityId,
                    Name = join.Amenity.Name,
                    Category = join.Amenity.AmenityCategory.Name
                })
                .ToList(),
            NearbyPlaces = property.NearbyPlaces
                .Where(place => place.IsActive)
                .OrderBy(place => place.Category)
                .ThenBy(place => place.Title)
                .Select(place => new PublicNearbyPlaceResponse
                {
                    Id = place.Id,
                    Title = place.Title,
                    Category = place.Category,
                    DistanceInMeters = place.DistanceInMeters,
                    WalkingMinutes = place.WalkingMinutes,
                    DrivingMinutes = place.DrivingMinutes,
                    Description = place.Description
                })
                .ToList(),
            Views = property.Views
                .OrderBy(view => view.ViewType)
                .Select(view => view.ViewType)
                .ToList(),
            RoomTypes = property.RoomTypes
                .Where(roomType => roomType.IsActive)
                .OrderBy(roomType => roomType.Name)
                .Select(roomType => new PublicRoomTypeResponse
                {
                    Id = roomType.Id,
                    Name = roomType.Name,
                    EnglishName = roomType.EnglishName,
                    Description = roomType.Description,
                    BasePrice = roomType.BasePrice,
                    AvailabilityPrice = roomType.Availability
                        .Where(availability => availability.Date >= today &&
                                               availability.Status != AvailabilityStatus.Unavailable)
                        .OrderBy(availability => availability.Date)
                        .Select(availability => (decimal?)availability.Price)
                        .FirstOrDefault(),
                    DisplayPrice = roomType.Availability
                        .Where(availability => availability.Date >= today &&
                                               availability.Status != AvailabilityStatus.Unavailable)
                        .OrderBy(availability => availability.Date)
                        .Select(availability => (decimal?)availability.Price)
                        .FirstOrDefault() ?? roomType.BasePrice,
                    AvailabilityStatus = roomType.Availability
                        .Where(availability => availability.Date >= today)
                        .OrderBy(availability => availability.Date)
                        .Select(availability => (AvailabilityStatus?)availability.Status)
                        .FirstOrDefault(),
                    InventoryMode = roomType.InventoryMode,
                    TotalInventory = roomType.TotalInventory,
                    MaxAdults = roomType.MaxAdults,
                    MaxChildren = roomType.MaxChildren,
                    Notes = roomType.Notes,
                    FloorNumber = roomType.FloorNumber,
                    StairCount = roomType.StairCount,
                    HasWindow = roomType.HasWindow,
                    HasPrivateBathroom = roomType.HasPrivateBathroom,
                    BedInformation = roomType.BedConfigurations
                        .OrderBy(configuration => configuration.BedType.Name)
                        .Select(configuration => configuration.Quantity + " x " + configuration.BedType.Name)
                        .ToList(),
                    Images = roomType.PropertyImages
                        .OrderByDescending(image => image.IsCover)
                        .ThenBy(image => image.SortOrder)
                        .Select(image => new PublicImageResponse
                        {
                            Id = image.Id,
                            Url = image.Url,
                            AltText = image.AltText,
                            Caption = image.Caption,
                            Tag = image.Tag,
                            IsCover = image.IsCover
                        })
                        .ToList(),
                    Amenities = roomType.RoomTypeAmenities
                        .OrderBy(join => join.Amenity.SortOrder)
                        .Select(join => new PublicAmenityResponse
                        {
                            Id = join.AmenityId,
                            Name = join.Amenity.Name,
                            Category = join.Amenity.AmenityCategory.Name
                        })
                        .ToList(),
                })
                .ToList()
        });
    }

    private static IReadOnlyList<int> ParseChildAges(string? childAges, int requestedChildren)
    {
        var ages = string.IsNullOrWhiteSpace(childAges)
            ? new List<int>()
            : childAges.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => int.TryParse(value, out var age) ? Math.Clamp(age, 0, 17) : (int?)null)
                .Where(age => age.HasValue)
                .Select(age => age!.Value)
                .ToList();

        while (ages.Count < requestedChildren)
        {
            ages.Add(17);
        }

        return ages.Take(requestedChildren).ToList();
    }

    private static int CountCapacityChildren(
        IReadOnlyList<int> childAges,
        int requestedChildren,
        int? freeChildAgeLimit,
        int? maxFreeChildren)
    {
        if (requestedChildren <= 0)
        {
            return 0;
        }

        if (!freeChildAgeLimit.HasValue || !maxFreeChildren.HasValue || maxFreeChildren.Value <= 0)
        {
            return requestedChildren;
        }

        var freeChildren = childAges
            .Take(requestedChildren)
            .Count(age => age <= freeChildAgeLimit.Value);

        return Math.Max(0, requestedChildren - Math.Min(freeChildren, maxFreeChildren.Value));
    }

    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
