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

        var slug = NormalizeSlug(request.Slug);
        await EnsureUniqueSlugAsync(propertyId, slug, null, cancellationToken);

        var roomType = new RoomType
        {
            PropertyId = propertyId,
            Name = request.Name.Trim(),
            Slug = slug,
            Description = request.Description.Trim(),
            MaxAdults = request.MaxAdults,
            MaxChildren = request.MaxChildren,
            TotalInventory = request.TotalInventory,
            InventoryMode = request.InventoryMode,
            BasePrice = request.BasePrice,
            IsActive = true
        };

        dbContext.RoomTypes.Add(roomType);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(roomType);
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
        var slug = NormalizeSlug(request.Slug);
        await EnsureUniqueSlugAsync(roomType.PropertyId, slug, roomTypeId, cancellationToken);

        roomType.Name = request.Name.Trim();
        roomType.Slug = slug;
        roomType.Description = request.Description.Trim();
        roomType.MaxAdults = request.MaxAdults;
        roomType.MaxChildren = request.MaxChildren;
        roomType.TotalInventory = request.TotalInventory;
        roomType.InventoryMode = request.InventoryMode;
        roomType.BasePrice = request.BasePrice;
        roomType.IsActive = request.IsActive;

        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(roomType);
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
                Slug = roomType.Slug,
                Description = roomType.Description,
                MaxAdults = roomType.MaxAdults,
                MaxChildren = roomType.MaxChildren,
                TotalInventory = roomType.TotalInventory,
                InventoryMode = roomType.InventoryMode,
                BasePrice = roomType.BasePrice,
                IsActive = roomType.IsActive
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
        var canManagePricing = await propertyAccessService.CanManagePricingAsync(
            userId, role, propertyId, cancellationToken);

        if (!canManageRooms || !canManagePricing)
        {
            throw new UnauthorizedAccessException("Room and pricing access are required.");
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

    private static RoomTypeResponse Map(RoomType roomType) => new()
    {
        Id = roomType.Id,
        PropertyId = roomType.PropertyId,
        Name = roomType.Name,
        Slug = roomType.Slug,
        Description = roomType.Description,
        MaxAdults = roomType.MaxAdults,
        MaxChildren = roomType.MaxChildren,
        TotalInventory = roomType.TotalInventory,
        InventoryMode = roomType.InventoryMode,
        BasePrice = roomType.BasePrice,
        IsActive = roomType.IsActive
    };

    private static string NormalizeSlug(string slug) => slug.Trim().ToLowerInvariant();
}
