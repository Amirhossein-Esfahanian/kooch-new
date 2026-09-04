using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Dtos.Properties;
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
[Route("api/bed-types")]
public class BedTypesController(
    KoochDbContext dbContext,
    ISvgSanitizer svgSanitizer,
    IMediaStorage mediaStorage,
    ILogger<BedTypesController> logger) : AuthenticatedControllerBase
{
    private const long MaxSvgFileSizeBytes = 256 * 1024;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<BedTypeResponse>>> Get(
        CancellationToken cancellationToken)
    {
        return Ok(await dbContext.BedTypes.AsNoTracking()
            .OrderBy(bedType => bedType.Name)
            .Select(bedType => new BedTypeResponse
            {
                Id = bedType.Id,
                Name = bedType.Name,
                Slug = bedType.Slug,
                Icon = bedType.Icon
            })
            .ToListAsync(cancellationToken));
    }

    [HttpPost]
    [AdminAuthorize]
    [ProducesResponseType<BedTypeResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<BedTypeResponse>> Create(
        CreateBedTypeRequest request,
        CancellationToken cancellationToken)
    {
        var name = RequireName(request.Name);
        var slug = RequireSlug(request.Slug);
        await EnsureUniqueSlugAsync(slug, cancellationToken);
        var uploadToken = Clean(request.IconUploadToken);
        _ = IconWriteRequestValidator.ValidateCreate(uploadToken, request.RemoveIcon);

        var bedType = new BedType
        {
            Name = name,
            Slug = slug,
            Icon = null
        };

        if (uploadToken is null)
        {
            dbContext.BedTypes.Add(bedType);
            await dbContext.SaveChangesAsync(cancellationToken);
            return StatusCode(StatusCodes.Status201Created, Map(bedType));
        }

        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            dbContext.BedTypes.Add(bedType);
            await dbContext.SaveChangesAsync(cancellationToken);
            finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                MediaAssetNamespace.BedTypes,
                uploadToken,
                bedType.Id,
                cancellationToken);
            bedType.Icon = finalizedAsset.PublicPath;
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            await RollbackAndCompensateAsync(transaction, finalizedAsset, bedType.Id);
            throw;
        }

        return StatusCode(StatusCodes.Status201Created, Map(bedType));
    }

    [HttpPut("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType<BedTypeResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<BedTypeResponse>> Update(
        int id,
        UpdateBedTypeRequest request,
        CancellationToken cancellationToken)
    {
        var bedType = await dbContext.BedTypes
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("نوع تخت موردنظر پیدا نشد.");
        var name = RequireName(request.Name);
        var uploadToken = Clean(request.IconUploadToken);
        var iconAction = IconWriteRequestValidator.ValidateUpdate(uploadToken, request.RemoveIcon);

        if (iconAction == IconWriteAction.Preserve)
        {
            bedType.Name = name;
            await dbContext.SaveChangesAsync(cancellationToken);
            return Ok(Map(bedType));
        }

        var previousIcon = bedType.Icon;
        StoredMediaAsset? finalizedAsset = null;
        await using var transaction = await BeginTransactionAsync(cancellationToken);
        try
        {
            bedType.Name = name;
            if (iconAction == IconWriteAction.Replace)
            {
                finalizedAsset = await mediaStorage.FinalizeStagedSvgAsync(
                    MediaAssetNamespace.BedTypes,
                    uploadToken!,
                    bedType.Id,
                    cancellationToken);
                bedType.Icon = finalizedAsset.PublicPath;
            }
            else
            {
                bedType.Icon = null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch
        {
            bedType.Icon = previousIcon;
            await RollbackAndCompensateAsync(transaction, finalizedAsset, bedType.Id);
            throw;
        }

        await CleanupPreviousAssetAsync(bedType.Id, previousIcon, bedType.Icon);
        return Ok(Map(bedType));
    }

    [HttpDelete("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var bedType = await dbContext.BedTypes
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("نوع تخت موردنظر پیدا نشد.");

        if (await dbContext.RoomTypeBeds.IgnoreQueryFilters()
                .AnyAsync(configuration => configuration.BedTypeId == id, cancellationToken))
        {
            throw new InvalidOperationException(
                "این نوع تخت در یک یا چند نوع اتاق استفاده شده است و قابل حذف نیست.");
        }

        bedType.IsDeleted = true;
        bedType.DeletedAtUtc = DateTime.UtcNow;
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
        try
        {
            if (file.Length <= 0)
            {
                throw new SvgSanitizationException(
                    SvgSanitizationFailure.EmptyInput,
                    "SVG file is empty.");
            }

            if (file.Length > MaxSvgFileSizeBytes)
            {
                throw new SvgSanitizationException(
                    SvgSanitizationFailure.TooLarge,
                    "SVG file is too large.");
            }

            await using var input = file.OpenReadStream();
            var sanitizedSvg = await svgSanitizer.SanitizeAsync(input, cancellationToken);
            var staged = await mediaStorage.StageSanitizedSvgAsync(
                MediaAssetNamespace.BedTypes,
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
                "Bed type SVG staging rejected with failure {Failure}.",
                exception.Failure);
            throw;
        }
        catch
        {
            logger.LogError("Bed type SVG staging failed.");
            throw;
        }
    }

    private async Task EnsureUniqueSlugAsync(string slug, CancellationToken cancellationToken)
    {
        if (await dbContext.BedTypes.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(item => item.Slug == slug, cancellationToken))
        {
            throw new InvalidOperationException("نوع تختی با این نامک از قبل وجود دارد.");
        }
    }

    private static string RequireName(string value)
    {
        var name = value?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("نام نوع تخت الزامی است.");
        }

        if (name.Length > 150)
        {
            throw new ArgumentException("نام نوع تخت نمی‌تواند بیشتر از ۱۵۰ نویسه باشد.");
        }

        return name;
    }

    private static string RequireSlug(string value)
    {
        var requestedSlug = value?.Trim();
        if (string.IsNullOrWhiteSpace(requestedSlug))
        {
            throw new ArgumentException("نامک نوع تخت الزامی است.");
        }

        if (requestedSlug.Length > 170)
        {
            throw new ArgumentException("نامک نوع تخت نمی‌تواند بیشتر از ۱۷۰ نویسه باشد.");
        }

        if (!requestedSlug.Any(character =>
                character is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9'))
        {
            throw new ArgumentException("نامک باید شامل حروف انگلیسی یا عدد باشد.");
        }

        return EnglishSlugGenerator.Create(requestedSlug, "bed-type");
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static BedTypeResponse Map(BedType bedType) => new()
    {
        Id = bedType.Id,
        Name = bedType.Name,
        Slug = bedType.Slug,
        Icon = bedType.Icon
    };

    private async Task<IDbContextTransaction?> BeginTransactionAsync(
        CancellationToken cancellationToken) =>
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
                logger.LogError(exception, "Bed type database rollback failed.");
            }
        }

        if (finalizedAsset is null)
        {
            return;
        }

        try
        {
            if (!await mediaStorage.DeleteOwnedAssetAsync(
                    MediaAssetNamespace.BedTypes,
                    entityId,
                    finalizedAsset.PublicPath,
                    CancellationToken.None))
            {
                logger.LogError("Bed type final-asset compensation could not find the owned asset.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Bed type final-asset compensation failed.");
        }
    }

    private async Task CleanupPreviousAssetAsync(
        int entityId,
        string? previousIcon,
        string? currentIcon)
    {
        if (string.IsNullOrWhiteSpace(previousIcon) ||
            string.Equals(previousIcon, currentIcon, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            await mediaStorage.DeleteOwnedAssetAsync(
                MediaAssetNamespace.BedTypes,
                entityId,
                previousIcon,
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Old bed type asset cleanup failed after commit.");
        }
    }
}
