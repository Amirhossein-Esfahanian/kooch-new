using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyImageService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IWebHostEnvironment environment) : IPropertyImageService
{
    private const long MaxFileSizeBytes = 5 * 1024 * 1024;
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    };

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
            await UnsetOtherCoversAsync(propertyId, request.RoomTypeId, null, cancellationToken);
        }

        var image = new PropertyImage { PropertyId = propertyId };
        Apply(image, request);
        dbContext.PropertyImages.Add(image);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(image);
    }

    public async Task<IReadOnlyList<PropertyImageResponse>> UploadAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyImageUploadRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(userId, role, propertyId, cancellationToken);
        await ValidateLinksAsync(propertyId, request.RoomTypeId, null, cancellationToken);

        if (request.Files.Count == 0)
        {
            throw new ArgumentException("At least one image file is required.");
        }

        var uploadRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads", "properties", propertyId.ToString());
        Directory.CreateDirectory(uploadRoot);

        var existingImages = await dbContext.PropertyImages
            .Where(image => image.PropertyId == propertyId)
            .ToListAsync(cancellationToken);
        var hasExistingImage = existingImages.Any(image => image.RoomTypeId == request.RoomTypeId && image.RoomId == null);
        var nextSortOrder = existingImages.Count == 0 ? 0 : existingImages.Max(image => image.SortOrder) + 1;
        var uploadedImages = new List<PropertyImage>();

        for (var index = 0; index < request.Files.Count; index += 1)
        {
            var file = request.Files[index];
            await ValidateUploadAsync(file, cancellationToken);
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var fileName = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}{extension}";
            var absolutePath = Path.Combine(uploadRoot, fileName);

            await using (var stream = File.Create(absolutePath))
            {
                await file.CopyToAsync(stream, cancellationToken);
            }

            var isCover = index == 0 && (request.IsCover || !hasExistingImage);
            if (isCover)
            {
                foreach (var cover in existingImages.Where(image =>
                             image.IsCover &&
                             image.RoomTypeId == request.RoomTypeId &&
                             image.RoomId == null))
                {
                    cover.IsCover = false;
                }
            }

            var image = new PropertyImage
            {
                PropertyId = propertyId,
                RoomTypeId = request.RoomTypeId,
                Url = $"/uploads/properties/{propertyId}/{fileName}",
                Tag = Clean(request.Tag),
                Caption = Clean(request.Caption),
                AltText = Clean(request.AltText),
                SortOrder = nextSortOrder++,
                IsCover = isCover,
                IsGallery = true
            };

            dbContext.PropertyImages.Add(image);
            existingImages.Add(image);
            uploadedImages.Add(image);
            hasExistingImage = true;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return uploadedImages.Select(Map).ToList();
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
            await UnsetOtherCoversAsync(image.PropertyId, request.RoomTypeId, image.Id, cancellationToken);
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

    private async Task UnsetOtherCoversAsync(int propertyId, int? roomTypeId, int? imageId, CancellationToken cancellationToken)
    {
        var covers = await dbContext.PropertyImages
            .Where(image => image.PropertyId == propertyId &&
                            image.RoomTypeId == roomTypeId &&
                            image.RoomId == null &&
                            image.IsCover &&
                            image.Id != imageId)
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

    private static async Task ValidateUploadAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ArgumentException("Uploaded file is empty.");
        }

        if (file.Length > MaxFileSizeBytes)
        {
            throw new ArgumentException("Each image must be 5MB or smaller.");
        }

        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            throw new ArgumentException("Only jpg, jpeg, png and webp files are allowed.");
        }

        var buffer = new byte[Math.Min(12, file.Length)];
        await using var stream = file.OpenReadStream();
        var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
        if (!HasKnownImageSignature(buffer.AsSpan(0, read), extension))
        {
            throw new ArgumentException("The uploaded file is not a supported image.");
        }
    }

    private static bool HasKnownImageSignature(ReadOnlySpan<byte> bytes, string extension)
    {
        if (extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
        }

        if (extension.Equals(".png", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 8 &&
                   bytes[0] == 0x89 &&
                   bytes[1] == 0x50 &&
                   bytes[2] == 0x4E &&
                   bytes[3] == 0x47 &&
                   bytes[4] == 0x0D &&
                   bytes[5] == 0x0A &&
                   bytes[6] == 0x1A &&
                   bytes[7] == 0x0A;
        }

        if (extension.Equals(".webp", StringComparison.OrdinalIgnoreCase))
        {
            return bytes.Length >= 12 &&
                   bytes[0] == 0x52 &&
                   bytes[1] == 0x49 &&
                   bytes[2] == 0x46 &&
                   bytes[3] == 0x46 &&
                   bytes[8] == 0x57 &&
                   bytes[9] == 0x45 &&
                   bytes[10] == 0x42 &&
                   bytes[11] == 0x50;
        }

        return false;
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
