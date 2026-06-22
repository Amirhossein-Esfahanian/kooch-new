using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;

namespace Kooch.Api.Services;

public class PropertyImageService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IWebHostEnvironment environment) : IPropertyImageService
{
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
        var constraints = await GetImageConstraintsAsync(cancellationToken);
        if (await dbContext.PropertyImages.CountAsync(image => image.PropertyId == propertyId, cancellationToken) >= constraints.MaxImagesPerProperty)
        {
            throw new ArgumentException("حداکثر تعداد تصاویر مجاز برای اقامتگاه تکمیل شده است.");
        }
        var generatedAltText = await GenerateAltTextAsync(propertyId, request.RoomTypeId, request.Tag, cancellationToken);
        if (request.IsCover)
        {
            await UnsetOtherCoversAsync(propertyId, request.RoomTypeId, null, cancellationToken);
        }

        var image = new PropertyImage { PropertyId = propertyId };
        Apply(image, request);
        image.AltText ??= generatedAltText;
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
        var generatedAltText = await GenerateAltTextAsync(propertyId, request.RoomTypeId, request.Tag, cancellationToken);

        if (request.Files.Count == 0)
        {
            throw new ArgumentException("حداقل یک تصویر انتخاب کنید.");
        }

        var constraints = await GetImageConstraintsAsync(cancellationToken);

        var uploadRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads", "properties", propertyId.ToString());
        Directory.CreateDirectory(uploadRoot);

        var existingImages = await dbContext.PropertyImages
            .Where(image => image.PropertyId == propertyId)
            .ToListAsync(cancellationToken);
        if (request.ReplaceImageId.HasValue && existingImages.All(image => image.Id != request.ReplaceImageId.Value))
        {
            throw new ArgumentException("تصویر جایگزین متعلق به این اقامتگاه نیست.");
        }
        var effectiveExistingCount = existingImages.Count - (request.ReplaceImageId.HasValue ? 1 : 0);
        if (effectiveExistingCount + request.Files.Count > constraints.MaxImagesPerProperty)
        {
            throw new ArgumentException("حداکثر تعداد تصاویر مجاز برای اقامتگاه تکمیل شده است.");
        }
        var hasExistingImage = existingImages.Any(image => image.RoomTypeId == request.RoomTypeId && image.RoomId == null);
        var nextSortOrder = existingImages.Count == 0 ? 0 : existingImages.Max(image => image.SortOrder) + 1;
        var uploadedImages = new List<PropertyImage>();

        for (var index = 0; index < request.Files.Count; index += 1)
        {
            var file = request.Files[index];
            await ValidateUploadAsync(file, constraints, cancellationToken);
            var extension = constraints.EnableWebpConversion ? ".webp" : Path.GetExtension(file.FileName).ToLowerInvariant();
            var fileName = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}{extension}";
            var absolutePath = Path.Combine(uploadRoot, fileName);

            if (constraints.EnableWebpConversion)
            {
                await using var input = file.OpenReadStream();
                using var decodedImage = await Image.LoadAsync(input, cancellationToken);
                await decodedImage.SaveAsWebpAsync(absolutePath, new WebpEncoder { Quality = 85 }, cancellationToken);
            }
            else
            {
                await using var stream = File.Create(absolutePath);
                await file.CopyToAsync(stream, cancellationToken);
            }

            var isCover = request.RoomTypeId == null && index == 0 && (request.IsCover || !hasExistingImage);
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
                AltText = Clean(request.AltText) ?? generatedAltText,
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
        var generatedAltText = await GenerateAltTextAsync(image.PropertyId, request.RoomTypeId, request.Tag, cancellationToken);
        if (request.IsCover)
        {
            await UnsetOtherCoversAsync(image.PropertyId, request.RoomTypeId, image.Id, cancellationToken);
        }

        Apply(image, request);
        image.AltText ??= generatedAltText;
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

    private async Task<string> GenerateAltTextAsync(
        int propertyId,
        int? roomTypeId,
        string? tag,
        CancellationToken cancellationToken)
    {
        var propertyName = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Id == propertyId)
            .Select(property => property.Name)
            .SingleAsync(cancellationToken);

        if (roomTypeId is not null)
        {
            var roomTypeName = await dbContext.RoomTypes.AsNoTracking()
                .Where(roomType => roomType.Id == roomTypeId)
                .Select(roomType => roomType.Name)
                .SingleAsync(cancellationToken);
            return $"اتاق {roomTypeName} {propertyName}";
        }

        return $"{TagLabel(tag)} {propertyName}";
    }

    private static string TagLabel(string? tag) => Clean(tag)?.ToLowerInvariant() switch
    {
        "exterior" => "نمای بیرونی",
        "courtyard" => "نمای حیاط",
        "lobby" => "لابی",
        "room" => "اتاق",
        "bathroom" => "حمام",
        "breakfast" => "صبحانه",
        "restaurant" => "رستوران",
        "amenities" => "امکانات",
        _ => "تصویر"
    };

    private async Task<ImageConstraints> GetImageConstraintsAsync(CancellationToken cancellationToken)
    {
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => setting.IsActive && setting.Group == "Images")
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value, cancellationToken);

        return new ImageConstraints(
            PositiveInt(values, "image.maxFileSizeMb", 2),
            PositiveInt(values, "image.minWidth", 800),
            PositiveInt(values, "image.minHeight", 600),
            PositiveInt(values, "image.maxImagesPerProperty", 30),
            !values.TryGetValue("image.enableWebpConversion", out var webp) || !bool.TryParse(webp, out var enabled) || enabled);
    }

    private static int PositiveInt(IReadOnlyDictionary<string, string> values, string key, int fallback) =>
        values.TryGetValue(key, out var value) && int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;

    private static async Task ValidateUploadAsync(IFormFile file, ImageConstraints constraints, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ArgumentException("فرمت فایل پشتیبانی نمی‌شود");
        }

        if (file.Length > constraints.MaxFileSizeMb * 1024L * 1024L)
        {
            throw new ArgumentException("حجم تصویر بیش از حد مجاز است");
        }

        var extension = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(extension))
        {
            throw new ArgumentException("فرمت فایل پشتیبانی نمی‌شود");
        }

        try
        {
            await using var stream = file.OpenReadStream();
            var info = await Image.IdentifyAsync(stream, cancellationToken);
            if (info.Width < constraints.MinWidth || info.Height < constraints.MinHeight)
            {
                throw new ArgumentException("ابعاد تصویر مناسب نیست");
            }
        }
        catch (ArgumentException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new ArgumentException("فرمت فایل پشتیبانی نمی‌شود");
        }
    }

    private sealed record ImageConstraints(
        int MaxFileSizeMb,
        int MinWidth,
        int MinHeight,
        int MaxImagesPerProperty,
        bool EnableWebpConversion);

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
