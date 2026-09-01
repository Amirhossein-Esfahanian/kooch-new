using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.Amenities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/amenity-categories")]
public class AmenityCategoriesController(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    ISvgSanitizer svgSanitizer,
    IMediaStorage mediaStorage,
    ILogger<AmenityCategoriesController> logger) : AuthenticatedControllerBase
{
    private const long MaxSvgFileSizeBytes = 256 * 1024;

    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType<IReadOnlyList<AmenityCategoryResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AmenityCategoryResponse>>> Get(
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.AmenityCategories.AsNoTracking()
            .Where(category => !category.IsDeleted);

        if (!includeInactive)
        {
            query = query.Where(category => category.IsActive);
        }

        var categories = await query
            .OrderBy(category => category.SortOrder)
            .ThenBy(category => category.Name)
            .Select(category => new AmenityCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Slug = category.Slug,
                SortOrder = category.SortOrder,
                Icon = category.Icon,
                IsActive = category.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(categories);
    }

    [HttpPost]
    [AdminAuthorize]
    [ProducesResponseType<AmenityCategoryResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AmenityCategoryResponse>> Create(
        AmenityCategoryRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var uploadToken = Clean(request.IconUploadToken);
        _ = IconWriteRequestValidator.ValidateCreate(
            uploadToken,
            request.RemoveIcon);
        var slug = await CreateUniqueSlugAsync(request.Slug, request.Name, null, cancellationToken);
        if (uploadToken is null)
        {
            var legacyCategory = new AmenityCategory
            {
                Name = request.Name.Trim(),
                Slug = slug,
                SortOrder = request.SortOrder,
                Icon = null,
                IsActive = request.IsActive,
                CreatedAtUtc = DateTime.UtcNow
            };

            dbContext.AmenityCategories.Add(legacyCategory);
            await dbContext.SaveChangesAsync(cancellationToken);
            return StatusCode(
                StatusCodes.Status201Created,
                await LoadAsync(legacyCategory.Id, cancellationToken));
        }

        var category = new AmenityCategory
        {
            Name = request.Name.Trim(),
            Slug = slug,
            SortOrder = request.SortOrder,
            Icon = null,
            IsActive = request.IsActive,
            CreatedAtUtc = DateTime.UtcNow
        };
        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            dbContext.AmenityCategories.Add(category);
            await dbContext.SaveChangesAsync(cancellationToken);
            finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                MediaAssetNamespace.AmenityCategories,
                uploadToken!,
                category.Id,
                cancellationToken);
            category.Icon = finalizedAsset.PublicPath;
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            await RollbackAndCompensateAsync(transaction, finalizedAsset, category.Id);
            throw;
        }

        return StatusCode(StatusCodes.Status201Created, await LoadAsync(category.Id, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType<AmenityCategoryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AmenityCategoryResponse>> Update(
        int id,
        AmenityCategoryRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var category = await dbContext.AmenityCategories
            .SingleOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity category not found.");

        var uploadToken = Clean(request.IconUploadToken);
        var iconAction = IconWriteRequestValidator.ValidateUpdate(
            uploadToken,
            request.RemoveIcon);
        if (iconAction == IconWriteAction.Preserve)
        {
            category.Name = request.Name.Trim();
            category.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
            category.SortOrder = request.SortOrder;
            category.IsActive = request.IsActive;
            category.UpdatedAtUtc = DateTime.UtcNow;

            await dbContext.SaveChangesAsync(cancellationToken);
            return Ok(await LoadAsync(category.Id, cancellationToken));
        }

        var previousIcon = category.Icon;
        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            category.Name = request.Name.Trim();
            category.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
            category.SortOrder = request.SortOrder;
            category.IsActive = request.IsActive;
            category.UpdatedAtUtc = DateTime.UtcNow;
            if (iconAction == IconWriteAction.Replace)
            {
                finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                    MediaAssetNamespace.AmenityCategories,
                    uploadToken!,
                    category.Id,
                    cancellationToken);
                category.Icon = finalizedAsset.PublicPath;
            }
            else
            {
                category.Icon = null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            category.Icon = previousIcon;
            await RollbackAndCompensateAsync(transaction, finalizedAsset, category.Id);
            throw;
        }

        await CleanupPreviousAssetAsync(category.Id, previousIcon, category.Icon);
        return Ok(await LoadAsync(category.Id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var category = await dbContext.AmenityCategories
            .Include(category => category.Amenities)
            .SingleOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity category not found.");

        var hasActiveAmenities = category.Amenities.Any(amenity => !amenity.IsDeleted);
        if (hasActiveAmenities)
        {
            return Conflict(new { message = "این دسته‌بندی دارای امکانات مرتبط است و قابل حذف نیست." });
        }

        category.IsDeleted = true;
        category.IsActive = false;
        category.DeletedAtUtc = DateTime.UtcNow;
        category.UpdatedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("svg/stage")]
    [AdminAuthorize]
    [Consumes("multipart/form-data")]
    [ProducesResponseType<AmenitySvgStageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AmenitySvgStageResponse>> StageSvg(
        [FromForm] IFormFile file,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        try
        {
            if (file.Length <= 0)
            {
                throw new SvgSanitizationException(SvgSanitizationFailure.EmptyInput, "SVG file is empty.");
            }

            if (file.Length > MaxSvgFileSizeBytes)
            {
                throw new SvgSanitizationException(SvgSanitizationFailure.TooLarge, "SVG file is too large.");
            }

            await using var input = file.OpenReadStream();
            var sanitizedSvg = await svgSanitizer.SanitizeAsync(input, cancellationToken);
            var staged = await mediaStorage.StageSanitizedSvgAsync(
                MediaAssetNamespace.AmenityCategories,
                sanitizedSvg,
                cancellationToken);
            return Ok(new AmenitySvgStageResponse(
                staged.UploadToken,
                staged.AssetNamespace,
                staged.ExpiresAtUtc));
        }
        catch (SvgSanitizationException exception)
        {
            logger.LogWarning(
                "Amenity category SVG staging rejected with failure {Failure}.",
                exception.Failure);
            throw;
        }
        catch
        {
            logger.LogError("Amenity category SVG staging failed.");
            throw;
        }
    }

    private async Task EnsureCanManageAmenitiesAsync(CancellationToken cancellationToken)
    {
        var (userId, _) = GetCurrentUser();
        if (!await permissionService.HasPermissionAsync(userId, PermissionKey.ManageAmenities, null, cancellationToken))
        {
            throw new UnauthorizedAccessException("ManageAmenities permission is required.");
        }
    }
    private async Task<AmenityCategoryResponse> LoadAsync(int id, CancellationToken cancellationToken) =>
        await dbContext.AmenityCategories.AsNoTracking()
            .Where(category => category.Id == id && !category.IsDeleted)
            .Select(category => new AmenityCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Slug = category.Slug,
                SortOrder = category.SortOrder,
                Icon = category.Icon,
                IsActive = category.IsActive
            })
            .SingleAsync(cancellationToken);

    private async Task<string> CreateUniqueSlugAsync(
        string? requestedSlug,
        string name,
        int? categoryId,
        CancellationToken cancellationToken)
    {
        var slug = EnglishSlugGenerator.Create(Clean(requestedSlug) ?? name, "amenity-category");
        if (await dbContext.AmenityCategories.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(category => category.Slug == slug && category.Id != categoryId, cancellationToken))
        {
            throw new InvalidOperationException("A category with this slug already exists.");
        }

        return slug;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private async Task<IDbContextTransaction?> BeginTransactionAsync(CancellationToken cancellationToken) =>
        dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

    private async Task RollbackAndCompensateAsync(
        IDbContextTransaction? transaction,
        StoredMediaAsset? finalizedAsset,
        int entityId)
    {
        if (transaction is not null)
        {
            try
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Amenity category database rollback failed.");
            }
        }

        if (finalizedAsset is null)
        {
            return;
        }

        try
        {
            if (!await mediaStorage.DeleteOwnedAssetAsync(
                    MediaAssetNamespace.AmenityCategories,
                    entityId,
                    finalizedAsset.PublicPath,
                    CancellationToken.None))
            {
                logger.LogError("Amenity category final-asset compensation could not find the owned asset.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Amenity category final-asset compensation failed.");
        }
    }

    private async Task CleanupPreviousAssetAsync(int entityId, string? previousIcon, string? currentIcon)
    {
        if (string.IsNullOrWhiteSpace(previousIcon) ||
            string.Equals(previousIcon, currentIcon, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            await mediaStorage.DeleteOwnedAssetAsync(
                MediaAssetNamespace.AmenityCategories,
                entityId,
                previousIcon,
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Old amenity category asset cleanup failed after commit.");
        }
    }

}

