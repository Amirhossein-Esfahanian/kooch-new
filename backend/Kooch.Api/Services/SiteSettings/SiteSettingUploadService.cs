using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using SixLabors.ImageSharp;

namespace Kooch.Api.Services.SiteSettings;

public sealed class SiteSettingUploadService(
    KoochDbContext dbContext,
    IMediaStorage mediaStorage,
    ISvgSanitizer svgSanitizer,
    ILogger<SiteSettingUploadService> logger) : ISiteSettingUploadService
{
    private const long MaximumFileSizeBytes = 5 * 1024 * 1024;
    private const string LogoKey = "site.logoUrl";
    private const string HeroBackgroundKey = "home.heroBackgroundUrl";
    private static readonly HashSet<string> RasterExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    };

    public async Task<SiteSetting> UploadAsync(
        string key,
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(file);
        var canonicalKey = ResolveUploadableKey(key);
        var setting = await dbContext.SiteSettings
            .SingleOrDefaultAsync(item => item.Key == canonicalKey, cancellationToken)
            ?? throw new KeyNotFoundException("Site setting was not found.");

        var extension = ValidateFileEnvelope(file, canonicalKey);
        StoredMediaAsset newAsset;
        if (extension.Equals(".svg", StringComparison.OrdinalIgnoreCase))
        {
            await using var input = file.OpenReadStream();
            var sanitizedSvg = await svgSanitizer.SanitizeAsync(input, cancellationToken);
            await using var sanitizedContent = new MemoryStream(Encoding.UTF8.GetBytes(sanitizedSvg));
            newAsset = await mediaStorage.StoreSanitizedSvgAsync(
                MediaAssetNamespace.SiteSettings,
                setting.Id,
                sanitizedContent,
                cancellationToken);
        }
        else
        {
            await ValidateRasterAsync(file, extension, cancellationToken);
            await using var validatedContent = file.OpenReadStream();
            newAsset = await mediaStorage.StoreValidatedRasterAsync(
                MediaAssetNamespace.SiteSettings,
                setting.Id,
                extension,
                validatedContent,
                cancellationToken);
        }

        var previousValue = setting.Value;
        IDbContextTransaction? transaction = null;
        try
        {
            transaction = await BeginTransactionAsync(cancellationToken);
            setting.Value = newAsset.PublicPath;
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }
        }
        catch (Exception exception)
        {
            setting.Value = previousValue;
            logger.LogError(
                exception,
                "Site setting asset persistence failed for key {SettingKey}; compensating the new asset.",
                canonicalKey);
            await RollbackAndCompensateAsync(transaction, newAsset, setting.Id);
            throw;
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }

        await CleanupPreviousAssetAsync(setting.Id, previousValue, setting.Value);
        return setting;
    }

    public async Task<SiteSetting> DeleteImageAsync(
        string key,
        CancellationToken cancellationToken = default)
    {
        var canonicalKey = ResolveUploadableKey(key);
        var setting = await dbContext.SiteSettings
            .SingleOrDefaultAsync(item => item.Key == canonicalKey, cancellationToken)
            ?? throw new KeyNotFoundException("Site setting was not found.");

        if (string.IsNullOrEmpty(setting.Value))
        {
            return setting;
        }

        var previousValue = setting.Value;
        await using (var transaction = await BeginTransactionAsync(cancellationToken))
        {
            try
            {
                setting.Value = string.Empty;
                await dbContext.SaveChangesAsync(cancellationToken);
                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken);
                }
            }
            catch
            {
                setting.Value = previousValue;
                throw;
            }
        }

        await CleanupPreviousAssetAsync(setting.Id, previousValue, setting.Value);
        return setting;
    }

    private static string ResolveUploadableKey(string key)
    {
        if (string.Equals(key, LogoKey, StringComparison.OrdinalIgnoreCase))
        {
            return LogoKey;
        }

        if (string.Equals(key, HeroBackgroundKey, StringComparison.OrdinalIgnoreCase))
        {
            return HeroBackgroundKey;
        }

        throw new ArgumentException("This setting does not support image uploads.", nameof(key));
    }

    private static string ValidateFileEnvelope(IFormFile file, string key)
    {
        if (file.Length <= 0)
        {
            throw new ArgumentException("Uploaded file is empty.", nameof(file));
        }

        if (file.Length > MaximumFileSizeBytes)
        {
            throw new ArgumentException("Image must be 5MB or smaller.", nameof(file));
        }

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension.Equals(".svg", StringComparison.OrdinalIgnoreCase))
        {
            if (!key.Equals(LogoKey, StringComparison.Ordinal))
            {
                throw new ArgumentException("SVG is only supported for the site logo.", nameof(file));
            }

            return extension;
        }

        if (!RasterExtensions.Contains(extension))
        {
            throw new ArgumentException("Only jpg, jpeg, png, webp and logo SVG files are allowed.", nameof(file));
        }

        return extension;
    }

    private static async Task ValidateRasterAsync(
        IFormFile file,
        string extension,
        CancellationToken cancellationToken)
    {
        string? decodedFormatName;
        try
        {
            await using var input = file.OpenReadStream();
            using var image = await Image.LoadAsync(input, cancellationToken);
            decodedFormatName = image.Metadata.DecodedImageFormat?.Name;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new ArgumentException("The uploaded file is not a valid raster image.", nameof(file), exception);
        }

        var matchesExtension = extension switch
        {
            ".jpg" or ".jpeg" => string.Equals(decodedFormatName, "JPEG", StringComparison.OrdinalIgnoreCase),
            ".png" => string.Equals(decodedFormatName, "PNG", StringComparison.OrdinalIgnoreCase),
            ".webp" => string.Equals(decodedFormatName, "WEBP", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
        if (!matchesExtension)
        {
            throw new ArgumentException(
                "The uploaded image content does not match its file extension.",
                nameof(file));
        }
    }

    private async Task<IDbContextTransaction?> BeginTransactionAsync(CancellationToken cancellationToken) =>
        dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

    private async Task RollbackAndCompensateAsync(
        IDbContextTransaction? transaction,
        StoredMediaAsset newAsset,
        int settingId)
    {
        if (transaction is not null)
        {
            try
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Site setting database rollback failed.");
            }
        }

        try
        {
            if (!await mediaStorage.DeleteOwnedAssetAsync(
                    MediaAssetNamespace.SiteSettings,
                    settingId,
                    newAsset.PublicPath,
                    CancellationToken.None))
            {
                logger.LogError("Site setting new-asset compensation could not find the owned asset.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Site setting new-asset compensation deletion failed.");
        }
    }

    private async Task CleanupPreviousAssetAsync(
        int settingId,
        string? previousValue,
        string currentValue)
    {
        if (string.IsNullOrWhiteSpace(previousValue) ||
            string.Equals(previousValue, currentValue, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            await mediaStorage.DeleteOwnedAssetAsync(
                MediaAssetNamespace.SiteSettings,
                settingId,
                previousValue,
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Old Site Settings asset cleanup failed after the replacement was committed.");
        }
    }
}
