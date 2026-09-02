using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Authentication;
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
[Route("api/amenities")]
public class AmenitiesController(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    ISvgSanitizer svgSanitizer,
    IMediaStorage mediaStorage,
    ILogger<AmenitiesController> logger) : AuthenticatedControllerBase
{
    private const long MaxSvgFileSizeBytes = 256 * 1024;

    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType<IReadOnlyList<AmenityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AmenityResponse>>> Get(
        CancellationToken cancellationToken)
    {
        var amenities = await dbContext.Amenities.AsNoTracking()
            .Where(amenity => amenity.AmenityCategory.IsActive)
            .OrderBy(amenity => amenity.AmenityCategory.SortOrder)
            .ThenBy(amenity => amenity.SortOrder)
            .ThenBy(amenity => amenity.Name)
            .Select(amenity => new AmenityResponse
            {
                Id = amenity.Id,
                AmenityCategoryId = amenity.AmenityCategoryId,
                CategoryName = amenity.AmenityCategory.Name,
                CategorySlug = amenity.AmenityCategory.Slug,
                CategorySortOrder = amenity.AmenityCategory.SortOrder,
                Name = amenity.Name,
                Slug = amenity.Slug,
                Description = amenity.Description,
                Icon = amenity.Icon,
                Scope = amenity.Scope,
                SortOrder = amenity.SortOrder
            })
            .ToListAsync(cancellationToken);

        return Ok(amenities);
    }

    [HttpPost]
    [AdminAuthorize]
    [ProducesResponseType<AmenityResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AmenityResponse>> Create(
        AmenityRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        EnsureValidScope(request.Scope);
        var uploadToken = Clean(request.IconUploadToken);
        _ = IconWriteRequestValidator.ValidateCreate(
            uploadToken,
            request.RemoveIcon);
        await EnsureCategoryAsync(request.AmenityCategoryId, cancellationToken);
        var slug = await CreateUniqueSlugAsync(request.Slug, request.Name, null, cancellationToken);
        if (uploadToken is null)
        {
            var legacyAmenity = new Amenity
            {
                AmenityCategoryId = request.AmenityCategoryId,
                Name = request.Name.Trim(),
                Slug = slug,
                Description = Clean(request.Description),
                Icon = null,
                Scope = request.Scope,
                SortOrder = request.SortOrder
            };
            dbContext.Amenities.Add(legacyAmenity);
            await dbContext.SaveChangesAsync(cancellationToken);
            return StatusCode(
                StatusCodes.Status201Created,
                await LoadAsync(legacyAmenity.Id, cancellationToken));
        }

        var amenity = new Amenity
        {
            AmenityCategoryId = request.AmenityCategoryId,
            Name = request.Name.Trim(),
            Slug = slug,
            Description = Clean(request.Description),
            Icon = null,
            Scope = request.Scope,
            SortOrder = request.SortOrder
        };
        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            dbContext.Amenities.Add(amenity);
            await dbContext.SaveChangesAsync(cancellationToken);
            finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                MediaAssetNamespace.Amenities,
                uploadToken!,
                amenity.Id,
                cancellationToken);
            amenity.Icon = finalizedAsset.PublicPath;
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            await RollbackAndCompensateAsync(transaction, finalizedAsset, amenity.Id);
            throw;
        }

        return StatusCode(StatusCodes.Status201Created, await LoadAsync(amenity.Id, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType<AmenityResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AmenityResponse>> Update(
        int id,
        AmenityRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var amenity = await dbContext.Amenities
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity not found.");

        EnsureValidScope(request.Scope);
        await EnsureScopeTransitionCompatibleAsync(
            amenity,
            request.Scope,
            cancellationToken);
        var uploadToken = Clean(request.IconUploadToken);
        var iconAction = IconWriteRequestValidator.ValidateUpdate(
            uploadToken,
            request.RemoveIcon);
        if (iconAction == IconWriteAction.Preserve)
        {
            await EnsureCategoryAsync(request.AmenityCategoryId, cancellationToken);
            amenity.AmenityCategoryId = request.AmenityCategoryId;
            amenity.Name = request.Name.Trim();
            amenity.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
            amenity.Description = Clean(request.Description);
            amenity.Scope = request.Scope;
            amenity.SortOrder = request.SortOrder;

            await dbContext.SaveChangesAsync(cancellationToken);
            return Ok(await LoadAsync(amenity.Id, cancellationToken));
        }

        await EnsureCategoryAsync(request.AmenityCategoryId, cancellationToken);
        var previousIcon = amenity.Icon;
        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            amenity.AmenityCategoryId = request.AmenityCategoryId;
            amenity.Name = request.Name.Trim();
            amenity.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
            amenity.Description = Clean(request.Description);
            amenity.Scope = request.Scope;
            amenity.SortOrder = request.SortOrder;
            if (iconAction == IconWriteAction.Replace)
            {
                finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                    MediaAssetNamespace.Amenities,
                    uploadToken!,
                    amenity.Id,
                    cancellationToken);
                amenity.Icon = finalizedAsset.PublicPath;
            }
            else
            {
                amenity.Icon = null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            amenity.Icon = previousIcon;
            await RollbackAndCompensateAsync(transaction, finalizedAsset, amenity.Id);
            throw;
        }

        await CleanupPreviousAssetAsync(amenity.Id, previousIcon, amenity.Icon);
        return Ok(await LoadAsync(amenity.Id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var amenity = await dbContext.Amenities
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity not found.");
        amenity.IsDeleted = true;
        amenity.DeletedAtUtc = DateTime.UtcNow;
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
                MediaAssetNamespace.Amenities,
                sanitizedSvg,
                cancellationToken);
            return Ok(new AmenitySvgStageResponse(
                staged.UploadToken,
                staged.AssetNamespace,
                staged.ExpiresAtUtc));
        }
        catch (SvgSanitizationException exception)
        {
            logger.LogWarning("Amenity SVG staging rejected with failure {Failure}.", exception.Failure);
            throw;
        }
        catch
        {
            logger.LogError("Amenity SVG staging failed.");
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
    private async Task EnsureCategoryAsync(int categoryId, CancellationToken cancellationToken)
    {
        if (!await dbContext.AmenityCategories.AsNoTracking()
                .AnyAsync(category => category.Id == categoryId && category.IsActive, cancellationToken))
        {
            throw new ArgumentException("Amenity category not found.");
        }
    }

    private async Task EnsureScopeTransitionCompatibleAsync(
        Amenity amenity,
        AmenityScope targetScope,
        CancellationToken cancellationToken)
    {
        if (amenity.Scope == targetScope || targetScope == AmenityScope.Both)
        {
            return;
        }

        if (targetScope == AmenityScope.Property &&
            await dbContext.RoomTypeAmenities.AsNoTracking()
                .AnyAsync(join => join.AmenityId == amenity.Id, cancellationToken))
        {
            throw new ArgumentException(
                "این امکان هنوز به نوع اتاق متصل است و نمی‌توان دامنه آن را فقط به اقامتگاه تغییر داد.");
        }

        if (targetScope == AmenityScope.RoomType &&
            await dbContext.PropertyAmenities.AsNoTracking()
                .AnyAsync(join => join.AmenityId == amenity.Id, cancellationToken))
        {
            throw new ArgumentException(
                "این امکان هنوز به اقامتگاه متصل است و نمی‌توان دامنه آن را فقط به نوع اتاق تغییر داد.");
        }
    }

    private static void EnsureValidScope(AmenityScope scope)
    {
        if (!Enum.IsDefined(scope))
        {
            throw new ArgumentException("دامنه استفاده امکان معتبر نیست.");
        }
    }

    private async Task<string> CreateUniqueSlugAsync(
        string? requestedSlug,
        string name,
        int? amenityId,
        CancellationToken cancellationToken)
    {
        var slug = EnglishSlugGenerator.Create(Clean(requestedSlug) ?? name, "amenity");
        if (await dbContext.Amenities.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(amenity => amenity.Slug == slug && amenity.Id != amenityId, cancellationToken))
        {
            throw new InvalidOperationException("An amenity with this slug already exists.");
        }

        return slug;
    }

    private Task<AmenityResponse> LoadAsync(int id, CancellationToken cancellationToken) =>
        dbContext.Amenities.AsNoTracking()
            .Where(amenity => amenity.Id == id)
            .Select(amenity => new AmenityResponse
            {
                Id = amenity.Id,
                AmenityCategoryId = amenity.AmenityCategoryId,
                CategoryName = amenity.AmenityCategory.Name,
                CategorySlug = amenity.AmenityCategory.Slug,
                CategorySortOrder = amenity.AmenityCategory.SortOrder,
                Name = amenity.Name,
                Slug = amenity.Slug,
                Description = amenity.Description,
                Icon = amenity.Icon,
                Scope = amenity.Scope,
                SortOrder = amenity.SortOrder
            })
            .SingleAsync(cancellationToken);

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
                logger.LogError(exception, "Amenity database rollback failed.");
            }
        }

        if (finalizedAsset is null)
        {
            return;
        }

        try
        {
            if (!await mediaStorage.DeleteOwnedAssetAsync(
                    MediaAssetNamespace.Amenities,
                    entityId,
                    finalizedAsset.PublicPath,
                    CancellationToken.None))
            {
                logger.LogError("Amenity final-asset compensation could not find the owned asset.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Amenity final-asset compensation failed.");
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
                MediaAssetNamespace.Amenities,
                entityId,
                previousIcon,
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Old amenity asset cleanup failed after commit.");
        }
    }

}

