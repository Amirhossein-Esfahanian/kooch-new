using System.Data;
using Kooch.Api.Catalogs;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class RoomService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IRoomService
{
    public async Task<OwnerRoomResponse> CreatePropertyRoomAsync(
        int userId,
        UserRole role,
        int propertyId,
        CreatePropertyRoomRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!RoomKindCatalog.IsDefined(request.RoomKind) || !Enum.IsDefined(request.InventoryMode))
        {
            throw new ArgumentException("Room template specification is invalid.");
        }

        if (!await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanManageRoomsAsync(
                userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage rooms for this property.");
        }

        var name = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Room name is required.", nameof(request));
        }

        var beds = await ValidateBedsAsync(request.BedConfigurations, cancellationToken);
        var amenityIds = await ValidateAmenityIdsAsync(request.AmenityIds, cancellationToken);

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        try
        {
            if (await dbContext.Rooms.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(room => room.RoomType.PropertyId == propertyId && room.Name == name, cancellationToken))
            {
                throw new InvalidOperationException("A room with this name already exists for the property.");
            }

            var roomType = await FindMatchingRoomTypeAsync(
                propertyId,
                request,
                beds,
                amenityIds,
                cancellationToken);

            if (roomType is null)
            {
                var internalIdentity = await GenerateInternalRoomTypeIdentityAsync(
                    propertyId,
                    request.RoomKind,
                    cancellationToken);
                roomType = new RoomType
                {
                    PropertyId = propertyId,
                    Name = internalIdentity.Name,
                    EnglishName = internalIdentity.Name,
                    Slug = internalIdentity.Slug,
                    Description = internalIdentity.Name,
                    RoomKind = request.RoomKind,
                    MaxAdults = request.MaxAdults,
                    MaxChildren = request.MaxChildren,
                    AllowExtraGuest = request.AllowExtraGuest,
                    MaxExtraGuests = request.AllowExtraGuest ? request.MaxExtraGuests : 0,
                    TotalInventory = 1,
                    InventoryMode = request.InventoryMode,
                    BasePrice = request.BasePrice,
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
            }
            else
            {
                roomType.TotalInventory++;
                roomType.IsActive = true;
            }

            var room = new Room
            {
                RoomType = roomType,
                Name = name,
                EnglishName = CleanOptional(request.EnglishName),
                Description = CleanOptional(request.Description),
                Notes = CleanOptional(request.Notes),
                FloorNumber = request.FloorNumber,
                StairCount = request.StairCount,
                HasWindow = request.HasWindow,
                HasPrivateBathroom = request.HasPrivateBathroom,
                IsActive = true
            };

            dbContext.Rooms.Add(room);
            await dbContext.SaveChangesAsync(cancellationToken);
            var response = await LoadOwnerRoomResponseAsync(room.Id, cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            return response;
        }
        catch
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            throw;
        }
    }

    public async Task<IReadOnlyList<OwnerRoomResponse>> GetRoomsByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (!await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        var rooms = await OwnerRoomQuery()
            .Where(room => room.RoomType.PropertyId == propertyId)
            .OrderBy(room => room.Name)
            .ToListAsync(cancellationToken);
        return rooms.Select(MapOwnerRoom).ToList();
    }

    public async Task<RoomResponse> CreateRoomAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CreateRoomRequest request,
        CancellationToken cancellationToken = default)
    {
        var roomType = await GetRoomTypeAsync(roomTypeId, cancellationToken);
        if (!await propertyAccessService.CanManageRoomsAsync(
                userId, role, roomType.PropertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage rooms for this property.");
        }

        var name = request.Name.Trim();
        if (await dbContext.Rooms.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(room => room.RoomTypeId == roomTypeId && room.Name == name, cancellationToken))
        {
            throw new InvalidOperationException("A room with this name already exists for the room type.");
        }

        var room = new Room
        {
            RoomTypeId = roomTypeId,
            Name = name,
            EnglishName = CleanOptional(request.EnglishName),
            Description = CleanOptional(request.Description),
            Notes = CleanOptional(request.Notes),
            FloorNumber = request.FloorNumber,
            StairCount = request.StairCount,
            HasWindow = request.HasWindow,
            HasPrivateBathroom = request.HasPrivateBathroom,
            IsActive = true
        };

        dbContext.Rooms.Add(room);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(room);
    }

    public async Task<IReadOnlyList<RoomResponse>> GetRoomsByRoomTypeAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CancellationToken cancellationToken = default)
    {
        var roomType = await GetRoomTypeAsync(roomTypeId, cancellationToken);
        if (!await propertyAccessService.CanViewAsync(userId, role, roomType.PropertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        return await dbContext.Rooms.AsNoTracking()
            .Where(room => room.RoomTypeId == roomTypeId)
            .OrderBy(room => room.Name)
            .Select(room => new RoomResponse
            {
                Id = room.Id,
                RoomTypeId = room.RoomTypeId,
                Name = room.Name,
                EnglishName = room.EnglishName,
                Description = room.Description,
                Notes = room.Notes,
                FloorNumber = room.FloorNumber,
                StairCount = room.StairCount,
                HasWindow = room.HasWindow,
                HasPrivateBathroom = room.HasPrivateBathroom,
                IsActive = room.IsActive
            })
            .ToListAsync(cancellationToken);
    }

    private async Task<RoomType> GetRoomTypeAsync(int roomTypeId, CancellationToken cancellationToken) =>
        await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(roomType => roomType.Id == roomTypeId, cancellationToken)
        ?? throw new KeyNotFoundException("Room type not found.");

    private async Task<RoomType?> FindMatchingRoomTypeAsync(
        int propertyId,
        CreatePropertyRoomRequest request,
        IReadOnlyDictionary<int, int> beds,
        IReadOnlyList<int> amenityIds,
        CancellationToken cancellationToken)
    {
        var normalizedExtraGuests = request.AllowExtraGuest ? request.MaxExtraGuests : 0;
        var candidates = await dbContext.RoomTypes
            .Where(roomType =>
                roomType.PropertyId == propertyId &&
                roomType.RoomKind == request.RoomKind &&
                roomType.MaxAdults == request.MaxAdults &&
                roomType.MaxChildren == request.MaxChildren &&
                roomType.AllowExtraGuest == request.AllowExtraGuest &&
                roomType.MaxExtraGuests == normalizedExtraGuests &&
                roomType.InventoryMode == request.InventoryMode &&
                roomType.BasePrice == request.BasePrice)
            .Include(roomType => roomType.BedConfigurations)
            .Include(roomType => roomType.RoomTypeAmenities)
            .OrderBy(roomType => roomType.Id)
            .ToListAsync(cancellationToken);

        return candidates.FirstOrDefault(candidate =>
            candidate.BedConfigurations.Count == beds.Count &&
            candidate.BedConfigurations.All(configuration =>
                beds.TryGetValue(configuration.BedTypeId, out var quantity) &&
                quantity == configuration.Quantity) &&
            candidate.RoomTypeAmenities.Select(item => item.AmenityId).Order()
                .SequenceEqual(amenityIds.Order()));
    }

    private async Task<(string Name, string Slug)> GenerateInternalRoomTypeIdentityAsync(
        int propertyId,
        RoomKind roomKind,
        CancellationToken cancellationToken)
    {
        var code = RoomKindCatalog.GetCode(roomKind);
        var suffix = 1;
        while (await dbContext.RoomTypes.IgnoreQueryFilters().AsNoTracking()
                   .AnyAsync(roomType =>
                       roomType.PropertyId == propertyId &&
                       roomType.Slug == $"{code}-{suffix}",
                       cancellationToken))
        {
            suffix++;
        }

        return ($"{roomKind}-{suffix}", $"{code}-{suffix}");
    }

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
        var ids = requestedIds.Where(id => id > 0).Distinct().Order().ToArray();
        var validCount = await dbContext.Amenities.AsNoTracking()
            .CountAsync(amenity => ids.Contains(amenity.Id) && amenity.Scope != AmenityScope.Property, cancellationToken);
        if (validCount != ids.Length)
        {
            throw new ArgumentException("One or more amenities are invalid for a room.");
        }

        return ids;
    }

    private IQueryable<Room> OwnerRoomQuery() =>
        dbContext.Rooms.AsNoTracking()
            .Include(room => room.RoomType)
                .ThenInclude(roomType => roomType.BedConfigurations)
                    .ThenInclude(configuration => configuration.BedType)
            .Include(room => room.RoomType)
                .ThenInclude(roomType => roomType.RoomTypeAmenities)
                    .ThenInclude(join => join.Amenity)
                        .ThenInclude(amenity => amenity.AmenityCategory);

    private async Task<OwnerRoomResponse> LoadOwnerRoomResponseAsync(
        int roomId,
        CancellationToken cancellationToken) =>
        MapOwnerRoom(await OwnerRoomQuery().SingleAsync(room => room.Id == roomId, cancellationToken));

    private static OwnerRoomResponse MapOwnerRoom(Room room) => new()
    {
        Id = room.Id,
        RoomTypeId = room.RoomTypeId,
        Name = room.Name,
        EnglishName = room.EnglishName,
        Description = room.Description,
        Notes = room.Notes,
        FloorNumber = room.FloorNumber,
        StairCount = room.StairCount,
        HasWindow = room.HasWindow,
        HasPrivateBathroom = room.HasPrivateBathroom,
        IsActive = room.IsActive,
        RoomKind = room.RoomType.RoomKind,
        InventoryMode = room.RoomType.InventoryMode,
        MaxAdults = room.RoomType.MaxAdults,
        MaxChildren = room.RoomType.MaxChildren,
        AllowExtraGuest = room.RoomType.AllowExtraGuest,
        MaxExtraGuests = room.RoomType.MaxExtraGuests,
        BasePrice = room.RoomType.BasePrice,
        BedConfigurations = room.RoomType.BedConfigurations
            .OrderBy(configuration => configuration.BedType.Name)
            .Select(configuration => new RoomTypeBedResponse
            {
                BedTypeId = configuration.BedTypeId,
                BedTypeName = configuration.BedType.Name,
                BedTypeSlug = configuration.BedType.Slug,
                Quantity = configuration.Quantity
            })
            .ToList(),
        Amenities = room.RoomType.RoomTypeAmenities
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
    };

    private static RoomResponse Map(Room room) => new()
    {
        Id = room.Id,
        RoomTypeId = room.RoomTypeId,
        Name = room.Name,
        EnglishName = room.EnglishName,
        Description = room.Description,
        Notes = room.Notes,
        FloorNumber = room.FloorNumber,
        StairCount = room.StairCount,
        HasWindow = room.HasWindow,
        HasPrivateBathroom = room.HasPrivateBathroom,
        IsActive = room.IsActive
    };

    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
