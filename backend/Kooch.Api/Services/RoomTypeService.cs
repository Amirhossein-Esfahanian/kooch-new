using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class RoomTypeService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IRoomTypeService
{
    public async Task<RoomTypeResponse> CreateRoomTypeAsync(
        int userId,
        UserRole role,
        int propertyId,
        CreateRoomTypeRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsurePropertyExistsAsync(propertyId, cancellationToken);
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);

        var englishName = CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.Create(englishName, "room-type");
        await EnsureUniqueSlugAsync(propertyId, slug, null, cancellationToken);
        var beds = await ValidateBedsAsync(request.BedConfigurations, cancellationToken);
        var amenityIds = await ValidateAmenityIdsAsync(request.AmenityIds, cancellationToken);

        var roomType = new RoomType
        {
            PropertyId = propertyId,
            Name = request.Name.Trim(),
            EnglishName = englishName,
            Slug = slug,
            Description = request.Description.Trim(),
            MaxAdults = request.MaxAdults,
            MaxChildren = request.MaxChildren,
            TotalInventory = request.TotalInventory,
            InventoryMode = request.InventoryMode,
            BasePrice = request.BasePrice,
            Notes = CleanOptional(request.Notes),
            FloorNumber = request.FloorNumber,
            StairCount = request.StairCount,
            HasWindow = request.HasWindow,
            HasPrivateBathroom = request.HasPrivateBathroom,
            IsActive = true,
            BedConfigurations = beds.Select(bed => new RoomTypeBed
            {
                BedTypeId = bed.Key,
                Quantity = bed.Value
            }).ToList(),
            RoomTypeAmenities = amenityIds.Select(amenityId => new RoomTypeAmenity
            {
                AmenityId = amenityId
            }).ToList()
        };

        dbContext.RoomTypes.Add(roomType);
        await dbContext.SaveChangesAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(englishName))
        {
            roomType.Slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "room-type", roomType.Id);
            await EnsureUniqueSlugAsync(propertyId, roomType.Slug, roomType.Id, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        return await LoadResponseAsync(roomType.Id, cancellationToken);
    }

    public async Task<RoomTypeResponse> UpdateRoomTypeAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        UpdateRoomTypeRequest request,
        CancellationToken cancellationToken = default)
    {
        var roomType = await dbContext.RoomTypes
            .SingleOrDefaultAsync(item => item.Id == roomTypeId, cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        await EnsureCanManageAsync(userId, role, roomType.PropertyId, cancellationToken);
        var englishName = request.EnglishName is null
            ? roomType.EnglishName
            : CleanOptional(request.EnglishName);
        var slug = EnglishSlugGenerator.CreateWithEntityFallback(englishName, "room-type", roomType.Id, roomType.Slug);
        await EnsureUniqueSlugAsync(roomType.PropertyId, slug, roomTypeId, cancellationToken);
        var beds = await ValidateBedsAsync(request.BedConfigurations, cancellationToken);
        var amenityIds = await ValidateAmenityIdsAsync(request.AmenityIds, cancellationToken);

        roomType.Name = request.Name.Trim();
        roomType.EnglishName = englishName;
        roomType.Slug = slug;
        roomType.Description = request.Description.Trim();
        roomType.MaxAdults = request.MaxAdults;
        roomType.MaxChildren = request.MaxChildren;
        roomType.TotalInventory = request.TotalInventory;
        roomType.InventoryMode = request.InventoryMode;
        roomType.BasePrice = request.BasePrice;
        roomType.Notes = CleanOptional(request.Notes);
        roomType.FloorNumber = request.FloorNumber;
        roomType.StairCount = request.StairCount;
        roomType.HasWindow = request.HasWindow;
        roomType.HasPrivateBathroom = request.HasPrivateBathroom;
        roomType.IsActive = request.IsActive;

        var existingBeds = await dbContext.RoomTypeBeds
            .Where(configuration => configuration.RoomTypeId == roomTypeId)
            .ToListAsync(cancellationToken);
        dbContext.RoomTypeBeds.RemoveRange(existingBeds);
        dbContext.RoomTypeBeds.AddRange(beds.Select(bed => new RoomTypeBed
        {
            RoomTypeId = roomTypeId,
            BedTypeId = bed.Key,
            Quantity = bed.Value
        }));

        var existingAmenities = await dbContext.RoomTypeAmenities
            .Where(join => join.RoomTypeId == roomTypeId)
            .ToListAsync(cancellationToken);
        dbContext.RoomTypeAmenities.RemoveRange(existingAmenities);
        dbContext.RoomTypeAmenities.AddRange(amenityIds.Select(amenityId => new RoomTypeAmenity
        {
            RoomTypeId = roomTypeId,
            AmenityId = amenityId
        }));

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadResponseAsync(roomType.Id, cancellationToken);
    }

    public async Task<IReadOnlyList<RoomTypeResponse>> GetRoomTypesByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsurePropertyExistsAsync(propertyId, cancellationToken);
        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        return await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.PropertyId == propertyId)
            .OrderBy(roomType => roomType.Name)
            .Select(roomType => new RoomTypeResponse
            {
                Id = roomType.Id,
                PropertyId = roomType.PropertyId,
                Name = roomType.Name,
                EnglishName = roomType.EnglishName,
                Slug = roomType.Slug,
                Description = roomType.Description,
                MaxAdults = roomType.MaxAdults,
                MaxChildren = roomType.MaxChildren,
                TotalInventory = roomType.TotalInventory,
                InventoryMode = roomType.InventoryMode,
                BasePrice = roomType.BasePrice,
                Notes = roomType.Notes,
                FloorNumber = roomType.FloorNumber,
                StairCount = roomType.StairCount,
                HasWindow = roomType.HasWindow,
                HasPrivateBathroom = roomType.HasPrivateBathroom,
                IsActive = roomType.IsActive,
                BedConfigurations = roomType.BedConfigurations
                    .OrderBy(configuration => configuration.BedType.Name)
                    .Select(configuration => new RoomTypeBedResponse
                    {
                        BedTypeId = configuration.BedTypeId,
                        BedTypeName = configuration.BedType.Name,
                        BedTypeSlug = configuration.BedType.Slug,
                        Quantity = configuration.Quantity
                    })
                    .ToList(),
                Amenities = roomType.RoomTypeAmenities
                    .OrderBy(join => join.Amenity.AmenityCategory.SortOrder)
                    .ThenBy(join => join.Amenity.SortOrder)
                    .Select(join => new RoomTypeAmenityResponse
                    {
                        AmenityId = join.AmenityId,
                        Name = join.Amenity.Name,
                        AmenityCategoryId = join.Amenity.AmenityCategoryId,
                        CategoryName = join.Amenity.AmenityCategory.Name
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);
    }

    private async Task EnsureCanManageAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var canManageRooms = await propertyAccessService.CanManageRoomsAsync(
            userId, role, propertyId, cancellationToken);

        if (!canManageRooms)
        {
            throw new UnauthorizedAccessException("Room management access is required.");
        }
    }

    private async Task EnsurePropertyExistsAsync(int propertyId, CancellationToken cancellationToken)
    {
        if (!await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }
    }

    private async Task EnsureUniqueSlugAsync(
        int propertyId,
        string slug,
        int? roomTypeId,
        CancellationToken cancellationToken)
    {
        if (await dbContext.RoomTypes.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(roomType => roomType.PropertyId == propertyId &&
                                      roomType.Slug == slug &&
                                      roomType.Id != roomTypeId,
                    cancellationToken))
        {
            throw new InvalidOperationException("A room type with this slug already exists for the property.");
        }
    }

    private async Task<RoomTypeResponse> LoadResponseAsync(int roomTypeId, CancellationToken cancellationToken) =>
        await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomType.Id == roomTypeId)
            .Select(roomType => new RoomTypeResponse
            {
                Id = roomType.Id,
                PropertyId = roomType.PropertyId,
                Name = roomType.Name,
                EnglishName = roomType.EnglishName,
                Slug = roomType.Slug,
                Description = roomType.Description,
                MaxAdults = roomType.MaxAdults,
                MaxChildren = roomType.MaxChildren,
                TotalInventory = roomType.TotalInventory,
                InventoryMode = roomType.InventoryMode,
                BasePrice = roomType.BasePrice,
                Notes = roomType.Notes,
                FloorNumber = roomType.FloorNumber,
                StairCount = roomType.StairCount,
                HasWindow = roomType.HasWindow,
                HasPrivateBathroom = roomType.HasPrivateBathroom,
                IsActive = roomType.IsActive,
                BedConfigurations = roomType.BedConfigurations
                    .OrderBy(configuration => configuration.BedType.Name)
                    .Select(configuration => new RoomTypeBedResponse
                    {
                        BedTypeId = configuration.BedTypeId,
                        BedTypeName = configuration.BedType.Name,
                        BedTypeSlug = configuration.BedType.Slug,
                        Quantity = configuration.Quantity
                    })
                    .ToList(),
                Amenities = roomType.RoomTypeAmenities
                    .OrderBy(join => join.Amenity.AmenityCategory.SortOrder)
                    .ThenBy(join => join.Amenity.SortOrder)
                    .Select(join => new RoomTypeAmenityResponse
                    {
                        AmenityId = join.AmenityId,
                        Name = join.Amenity.Name,
                        AmenityCategoryId = join.Amenity.AmenityCategoryId,
                        CategoryName = join.Amenity.AmenityCategory.Name
                    })
                    .ToList()
            })
            .SingleAsync(cancellationToken);

    private async Task<Dictionary<int, int>> ValidateBedsAsync(
        IReadOnlyCollection<RoomTypeBedRequest> requestedBeds,
        CancellationToken cancellationToken)
    {
        if (requestedBeds.Any(bed => bed.BedTypeId <= 0 || bed.Quantity <= 0))
        {
            throw new ArgumentException("Bed type and quantity must be positive.");
        }

        var beds = requestedBeds
            .GroupBy(bed => bed.BedTypeId)
            .ToDictionary(group => group.Key, group => group.Sum(bed => bed.Quantity));
        var validCount = await dbContext.BedTypes.AsNoTracking()
            .CountAsync(bedType => beds.Keys.Contains(bedType.Id), cancellationToken);
        if (validCount != beds.Count)
        {
            throw new ArgumentException("One or more bed types are invalid.");
        }

        return beds;
    }

    private async Task<IReadOnlyList<int>> ValidateAmenityIdsAsync(
        IReadOnlyCollection<int> requestedIds,
        CancellationToken cancellationToken)
    {
        var ids = requestedIds.Where(id => id > 0).Distinct().ToArray();
        var validCount = await dbContext.Amenities.AsNoTracking()
            .CountAsync(amenity => ids.Contains(amenity.Id) && amenity.Scope != AmenityScope.Property, cancellationToken);
        if (validCount != ids.Length)
        {
            throw new ArgumentException("One or more amenities are invalid for a room type.");
        }

        return ids;
    }

    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
