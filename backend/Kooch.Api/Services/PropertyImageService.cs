using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyImageService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyImageService
{
    public async Task<IReadOnlyList<PropertyImageResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureCanViewAsync(userId, role, propertyId, cancellationToken);
        return await dbContext.PropertyImages.AsNoTracking()
            .Where(image => image.PropertyId == propertyId)
            .OrderByDescending(image => image.IsCover)
            .ThenBy(image => image.SortOrder)
            .ThenBy(image => image.Id)
            .Select(image => new PropertyImageResponse
            {
                Id = image.Id,
                PropertyId = image.PropertyId,
                RoomTypeId = image.RoomTypeId,
                RoomId = image.RoomId,
                Url = image.Url,
                AltText = image.AltText,
                Caption = image.Caption,
                Tag = image.Tag,
                SortOrder = image.SortOrder,
                IsCover = image.IsCover,
                IsGallery = image.IsGallery
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PropertyImageResponse> CreateAsync(
        int userId, UserRole role, int propertyId, PropertyImageRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        await ValidateLinksAsync(propertyId, request.RoomTypeId, request.RoomId, cancellationToken);
        if (request.IsCover)
        {
            await UnsetOtherCoversAsync(propertyId, null, cancellationToken);
        }

        var image = new PropertyImage { PropertyId = propertyId };
        Apply(image, request);
        dbContext.PropertyImages.Add(image);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(image);
    }

    public async Task<PropertyImageResponse> UpdateAsync(
        int userId, UserRole role, int imageId, PropertyImageRequest request, CancellationToken cancellationToken = default)
    {
        var image = await dbContext.PropertyImages.SingleOrDefaultAsync(item => item.Id == imageId, cancellationToken)
            ?? throw new KeyNotFoundException("Property image not found.");
        await EnsureCanManageAsync(userId, role, image.PropertyId, cancellationToken);
        await ValidateLinksAsync(image.PropertyId, request.RoomTypeId, request.RoomId, cancellationToken);
        if (request.IsCover)
        {
            await UnsetOtherCoversAsync(image.PropertyId, image.Id, cancellationToken);
        }

        Apply(image, request);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(image);
    }

    public async Task DeleteAsync(
        int userId, UserRole role, int imageId, CancellationToken cancellationToken = default)
    {
        var image = await dbContext.PropertyImages.SingleOrDefaultAsync(item => item.Id == imageId, cancellationToken)
            ?? throw new KeyNotFoundException("Property image not found.");
        await EnsureCanManageAsync(userId, role, image.PropertyId, cancellationToken);
        image.IsDeleted = true;
        image.DeletedAtUtc = DateTime.UtcNow;
        image.DeletedByUserId = userId;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureCanViewAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access images for this property.");
        }
    }

    private async Task EnsureCanManageAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken)
    {
        var allowed = await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken) ||
                      await propertyAccessService.CanManageRoomsAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot manage images for this property.");
        }
    }

    private async Task ValidateLinksAsync(int propertyId, int? roomTypeId, int? roomId, CancellationToken cancellationToken)
    {
        if (roomTypeId is not null && !await dbContext.RoomTypes.AsNoTracking()
                .AnyAsync(roomType => roomType.Id == roomTypeId && roomType.PropertyId == propertyId, cancellationToken))
        {
            throw new ArgumentException("The selected room type does not belong to this property.");
        }

        if (roomId is not null)
        {
            var room = await dbContext.Rooms.AsNoTracking()
                .Where(item => item.Id == roomId)
                .Select(item => new { item.RoomTypeId, item.RoomType.PropertyId })
                .SingleOrDefaultAsync(cancellationToken);
            if (room is null || room.PropertyId != propertyId || roomTypeId is not null && room.RoomTypeId != roomTypeId)
            {
                throw new ArgumentException("The selected room does not belong to this property or room type.");
            }
        }
    }

    private async Task UnsetOtherCoversAsync(int propertyId, int? imageId, CancellationToken cancellationToken)
    {
        var covers = await dbContext.PropertyImages
            .Where(image => image.PropertyId == propertyId && image.IsCover && image.Id != imageId)
            .ToListAsync(cancellationToken);
        foreach (var cover in covers)
        {
            cover.IsCover = false;
        }
    }

    private static void Apply(PropertyImage image, PropertyImageRequest request)
    {
        image.Url = request.Url.Trim();
        image.AltText = Clean(request.AltText);
        image.Caption = Clean(request.Caption);
        image.Tag = Clean(request.Tag);
        image.RoomTypeId = request.RoomTypeId;
        image.RoomId = request.RoomId;
        image.SortOrder = request.SortOrder;
        image.IsCover = request.IsCover;
        image.IsGallery = request.IsGallery;
    }

    private static PropertyImageResponse Map(PropertyImage image) => new()
    {
        Id = image.Id,
        PropertyId = image.PropertyId,
        RoomTypeId = image.RoomTypeId,
        RoomId = image.RoomId,
        Url = image.Url,
        AltText = image.AltText,
        Caption = image.Caption,
        Tag = image.Tag,
        SortOrder = image.SortOrder,
        IsCover = image.IsCover,
        IsGallery = image.IsGallery
    };

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
