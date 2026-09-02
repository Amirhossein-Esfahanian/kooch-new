using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertySettings;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PropertySettingService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertySettingService
{
    public async Task<IReadOnlyList<PropertySettingResponse>> GetCatalogAsync(
        bool includeInactive,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.PropertySettings.AsNoTracking();
        if (!includeInactive)
        {
            query = query.Where(setting => setting.IsActive);
        }

        return await query
            .OrderBy(setting => setting.SortOrder)
            .ThenBy(setting => setting.Name)
            .Select(setting => new PropertySettingResponse
            {
                Id = setting.Id,
                Name = setting.Name,
                Slug = setting.Slug,
                SortOrder = setting.SortOrder,
                IsActive = setting.IsActive
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PropertySettingResponse> CreateAsync(
        CreatePropertySettingRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = RequireName(request.Name);
        var slug = RequireSlug(request.Slug);
        await EnsureUniqueSlugAsync(slug, cancellationToken);

        var setting = new PropertySetting
        {
            Name = name,
            Slug = slug,
            SortOrder = request.SortOrder,
            IsActive = request.IsActive
        };
        dbContext.PropertySettings.Add(setting);
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapCatalog(setting);
    }

    public async Task<PropertySettingResponse> UpdateAsync(
        int id,
        UpdatePropertySettingRequest request,
        CancellationToken cancellationToken = default)
    {
        var setting = await dbContext.PropertySettings
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("بافت و موقعیت موردنظر پیدا نشد.");

        setting.Name = RequireName(request.Name);
        setting.SortOrder = request.SortOrder;
        setting.IsActive = request.IsActive;
        await dbContext.SaveChangesAsync(cancellationToken);
        return MapCatalog(setting);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var setting = await dbContext.PropertySettings
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("بافت و موقعیت موردنظر پیدا نشد.");

        if (await dbContext.PropertySettingAssignments.IgnoreQueryFilters()
                .AnyAsync(assignment => assignment.PropertySettingId == id, cancellationToken))
        {
            throw new InvalidOperationException(
                "این بافت و موقعیت دارای اقامتگاه مرتبط است و قابل حذف نیست؛ آن را غیرفعال کنید.");
        }

        setting.IsActive = false;
        setting.IsDeleted = true;
        setting.DeletedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PropertySettingAssignmentResponse>> GetPropertySettingsAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsurePropertyAccessAsync(userId, role, propertyId, manage: false, cancellationToken);
        return await LoadPropertySettingsAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertySettingAssignmentResponse>> ReplacePropertySettingsAsync(
        int userId,
        UserRole role,
        int propertyId,
        SetPropertySettingsRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsurePropertyAccessAsync(userId, role, propertyId, manage: true, cancellationToken);

        var requestedIds = request.PropertySettingIds.ToHashSet();
        if (requestedIds.Any(id => id <= 0))
        {
            throw new ArgumentException("یک یا چند بافت و موقعیت انتخاب‌شده معتبر نیست.");
        }

        var existingAssignments = await dbContext.PropertySettingAssignments.IgnoreQueryFilters()
            .Where(assignment => assignment.PropertyId == propertyId)
            .ToListAsync(cancellationToken);
        var currentSettingIds = existingAssignments
            .Where(assignment => !assignment.IsDeleted)
            .Select(assignment => assignment.PropertySettingId)
            .ToHashSet();

        var requestedSettings = await dbContext.PropertySettings.IgnoreQueryFilters().AsNoTracking()
            .Where(setting => requestedIds.Contains(setting.Id))
            .ToListAsync(cancellationToken);
        if (requestedSettings.Count != requestedIds.Count || requestedSettings.Any(setting => setting.IsDeleted))
        {
            throw new ArgumentException("یک یا چند بافت و موقعیت انتخاب‌شده معتبر نیست.");
        }

        if (requestedSettings.Any(setting => !setting.IsActive && !currentSettingIds.Contains(setting.Id)))
        {
            throw new ArgumentException("بافت و موقعیت غیرفعال را نمی‌توان به اقامتگاه افزود.");
        }

        var remainingIds = requestedIds.ToHashSet();
        foreach (var assignment in existingAssignments)
        {
            if (remainingIds.Remove(assignment.PropertySettingId))
            {
                assignment.IsDeleted = false;
                assignment.DeletedAtUtc = null;
                assignment.DeletedByUserId = null;
            }
            else if (!assignment.IsDeleted)
            {
                assignment.IsDeleted = true;
                assignment.DeletedAtUtc = DateTime.UtcNow;
                assignment.DeletedByUserId = userId;
            }
        }

        dbContext.PropertySettingAssignments.AddRange(remainingIds.Select(settingId =>
            new PropertySettingAssignment
            {
                PropertyId = propertyId,
                PropertySettingId = settingId,
                CreatedByUserId = userId
            }));

        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadPropertySettingsAsync(propertyId, cancellationToken);
    }

    private async Task EnsurePropertyAccessAsync(
        int userId,
        UserRole role,
        int propertyId,
        bool manage,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("اقامتگاه موردنظر پیدا نشد.");
        }

        var allowed = manage
            ? await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken)
            : await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("شما به بافت و موقعیت این اقامتگاه دسترسی ندارید.");
        }
    }

    private Task<List<PropertySettingAssignmentResponse>> LoadPropertySettingsAsync(
        int propertyId,
        CancellationToken cancellationToken) =>
        dbContext.PropertySettingAssignments.AsNoTracking()
            .Where(assignment => assignment.PropertyId == propertyId)
            .OrderBy(assignment => assignment.PropertySetting.SortOrder)
            .ThenBy(assignment => assignment.PropertySetting.Name)
            .Select(assignment => new PropertySettingAssignmentResponse
            {
                Id = assignment.PropertySettingId,
                Name = assignment.PropertySetting.Name,
                Slug = assignment.PropertySetting.Slug,
                IsActive = assignment.PropertySetting.IsActive
            })
            .ToListAsync(cancellationToken);

    private async Task EnsureUniqueSlugAsync(string slug, CancellationToken cancellationToken)
    {
        if (await dbContext.PropertySettings.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(setting => setting.Slug == slug, cancellationToken))
        {
            throw new InvalidOperationException("بافت و موقعیتی با این نامک از قبل وجود دارد.");
        }
    }

    private static string RequireName(string value)
    {
        var name = value?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("نام بافت و موقعیت الزامی است.");
        }

        if (name.Length > 150)
        {
            throw new ArgumentException("نام بافت و موقعیت نمی‌تواند بیشتر از ۱۵۰ نویسه باشد.");
        }

        return name;
    }

    private static string RequireSlug(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("نامک بافت و موقعیت الزامی است.");
        }

        var requestedSlug = value.Trim();
        if (requestedSlug.Length > 170)
        {
            throw new ArgumentException("نامک بافت و موقعیت نمی‌تواند بیشتر از ۱۷۰ نویسه باشد.");
        }

        if (!requestedSlug.Any(character =>
                character is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9'))
        {
            throw new ArgumentException("نامک باید شامل حروف انگلیسی یا عدد باشد.");
        }

        var slug = EnglishSlugGenerator.Create(requestedSlug, "property-setting");

        return slug;
    }

    private static PropertySettingResponse MapCatalog(PropertySetting setting) => new()
    {
        Id = setting.Id,
        Name = setting.Name,
        Slug = setting.Slug,
        SortOrder = setting.SortOrder,
        IsActive = setting.IsActive
    };
}
