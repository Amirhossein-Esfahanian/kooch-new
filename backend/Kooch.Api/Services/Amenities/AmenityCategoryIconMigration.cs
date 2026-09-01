using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Kooch.Api.Services.Amenities;

public sealed class AmenityCategoryIconMigration(
    KoochDbContext dbContext,
    IWebHostEnvironment environment,
    ISvgSanitizer svgSanitizer,
    IMediaStorage mediaStorage,
    ILogger<AmenityCategoryIconMigration> logger) : IAmenityCategoryIconMigration
{
    private static readonly MigrationMapping[] Mappings =
    [
        new("base-services", "utilities", "base-services.svg"),
        new("health-bathroom", "bath", "health-bathroom.svg"),
        new("kitchen", "kitchen", "kitchen.svg"),
        new("comfort-welfare", "sofa", "comfort-welfare.svg"),
        new("entertainment", "gamepad", "entertainment.svg"),
        new("safety", "shield", "safety.svg"),
        new("environment", "garden", "environment.svg"),
        new("exclusive-features", "star", "exclusive-features.svg")
    ];

    public async Task<AmenityCategoryIconMigrationResult> MigrateAsync(
        CancellationToken cancellationToken = default)
    {
        var migratedCount = 0;
        var skippedCount = 0;
        var failures = new List<AmenityCategoryIconMigrationFailure>();

        foreach (var mapping in Mappings)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var category = await dbContext.AmenityCategories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(item => item.Slug == mapping.CategorySlug, cancellationToken);
            if (category is null)
            {
                skippedCount++;
                logger.LogInformation(
                    "Amenity category icon migration skipped missing category {CategorySlug}.",
                    mapping.CategorySlug);
                continue;
            }

            if (!string.Equals(category.Icon, mapping.ExpectedLegacyIcon, StringComparison.Ordinal))
            {
                skippedCount++;
                logger.LogInformation(
                    "Amenity category icon migration skipped {CategorySlug} because its icon is not the expected legacy symbol.",
                    mapping.CategorySlug);
                continue;
            }

            string sanitizedSvg;
            var sourcePath = Path.Combine(
                environment.WebRootPath,
                "svgs",
                "amenity-categories",
                mapping.SourceFileName);
            try
            {
                await using var source = File.OpenRead(sourcePath);
                sanitizedSvg = await svgSanitizer.SanitizeAsync(source, cancellationToken);
            }
            catch (FileNotFoundException exception)
            {
                logger.LogError(
                    exception,
                    "Amenity category icon migration source {SourceFileName} is missing for {CategorySlug}.",
                    mapping.SourceFileName,
                    mapping.CategorySlug);
                failures.Add(new(
                    mapping.CategorySlug,
                    AmenityCategoryIconMigrationFailureStage.Source,
                    "The mapped source SVG is missing."));
                continue;
            }
            catch (SvgSanitizationException exception)
            {
                logger.LogError(
                    exception,
                    "Amenity category icon migration sanitization failed for {CategorySlug} with {Failure}.",
                    mapping.CategorySlug,
                    exception.Failure);
                failures.Add(new(
                    mapping.CategorySlug,
                    AmenityCategoryIconMigrationFailureStage.Sanitization,
                    "The mapped source SVG failed sanitization."));
                continue;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(
                    exception,
                    "Amenity category icon migration could not read source {SourceFileName} for {CategorySlug}.",
                    mapping.SourceFileName,
                    mapping.CategorySlug);
                failures.Add(new(
                    mapping.CategorySlug,
                    AmenityCategoryIconMigrationFailureStage.Source,
                    "The mapped source SVG could not be read."));
                continue;
            }

            StoredMediaAsset storedAsset;
            try
            {
                await using var content = new MemoryStream(Encoding.UTF8.GetBytes(sanitizedSvg));
                storedAsset = await mediaStorage.StoreSanitizedSvgAsync(
                    MediaAssetNamespace.AmenityCategories,
                    category.Id,
                    content,
                    cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(
                    exception,
                    "Amenity category icon migration storage failed for {CategorySlug} and entity {EntityId}.",
                    mapping.CategorySlug,
                    category.Id);
                failures.Add(new(
                    mapping.CategorySlug,
                    AmenityCategoryIconMigrationFailureStage.Storage,
                    "The sanitized SVG could not be stored."));
                continue;
            }

            IDbContextTransaction? transaction = null;
            try
            {
                transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var updatedRows = await dbContext.AmenityCategories
                    .IgnoreQueryFilters()
                    .Where(item =>
                        item.Id == category.Id &&
                        item.Slug == mapping.CategorySlug &&
                        item.Icon == mapping.ExpectedLegacyIcon)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(item => item.Icon, storedAsset.PublicPath),
                        cancellationToken);

                if (updatedRows == 0)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    if (!await CompensateAsync(mapping.CategorySlug, category.Id, storedAsset, failures))
                    {
                        continue;
                    }

                    skippedCount++;
                    logger.LogInformation(
                        "Amenity category icon migration skipped {CategorySlug} because its icon changed concurrently.",
                        mapping.CategorySlug);
                    continue;
                }

                await transaction.CommitAsync(cancellationToken);
                migratedCount++;
                logger.LogInformation(
                    "Amenity category icon migration completed for {CategorySlug} and entity {EntityId}.",
                    mapping.CategorySlug,
                    category.Id);
            }
            catch (Exception exception)
            {
                await RollbackAsync(transaction, mapping.CategorySlug);
                if (exception is not OperationCanceledException)
                {
                    logger.LogError(
                        exception,
                        "Amenity category icon migration database update failed for {CategorySlug} and entity {EntityId}.",
                        mapping.CategorySlug,
                        category.Id);
                    failures.Add(new(
                        mapping.CategorySlug,
                        AmenityCategoryIconMigrationFailureStage.Database,
                        "The database icon update failed."));
                }

                await CompensateAsync(mapping.CategorySlug, category.Id, storedAsset, failures);

                if (exception is OperationCanceledException)
                {
                    throw;
                }
            }
            finally
            {
                if (transaction is not null)
                {
                    await transaction.DisposeAsync();
                }
            }
        }

        return new AmenityCategoryIconMigrationResult(migratedCount, skippedCount, failures);
    }

    private async Task<bool> CompensateAsync(
        string categorySlug,
        int categoryId,
        StoredMediaAsset storedAsset,
        ICollection<AmenityCategoryIconMigrationFailure> failures)
    {
        try
        {
            var deleted = await mediaStorage.DeleteOwnedAssetAsync(
                MediaAssetNamespace.AmenityCategories,
                categoryId,
                storedAsset.PublicPath,
                CancellationToken.None);
            if (deleted)
            {
                return true;
            }

            logger.LogError(
                "Amenity category icon migration compensation could not find the owned asset for {CategorySlug} and entity {EntityId}.",
                categorySlug,
                categoryId);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Amenity category icon migration compensation failed for {CategorySlug} and entity {EntityId}.",
                categorySlug,
                categoryId);
        }

        failures.Add(new(
            categorySlug,
            AmenityCategoryIconMigrationFailureStage.Compensation,
            "The newly stored asset could not be removed after migration failure."));
        return false;
    }

    private async Task RollbackAsync(IDbContextTransaction? transaction, string categorySlug)
    {
        if (transaction is null)
        {
            return;
        }

        try
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Amenity category icon migration database rollback failed for {CategorySlug}.",
                categorySlug);
        }
    }

    private sealed record MigrationMapping(
        string CategorySlug,
        string ExpectedLegacyIcon,
        string SourceFileName);
}
