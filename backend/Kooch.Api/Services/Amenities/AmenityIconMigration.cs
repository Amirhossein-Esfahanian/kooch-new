using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Kooch.Api.Services.Amenities;

public sealed class AmenityIconMigration(
    KoochDbContext dbContext,
    IWebHostEnvironment environment,
    ISvgSanitizer svgSanitizer,
    IMediaStorage mediaStorage,
    ILogger<AmenityIconMigration> logger) : IAmenityIconMigration
{
    private static readonly MigrationMapping[] Mappings =
    [
        new("water", "/svgs/amenities/water.svg", "water.svg"),
        new("gas", "/svgs/amenities/gas.svg", "gas.svg"),
        new("wifi", "/svgs/amenities/wifi.svg", "wifi.svg")
    ];

    public async Task<AmenityIconMigrationResult> MigrateAsync(
        CancellationToken cancellationToken = default)
    {
        var migratedCount = 0;
        var skippedCount = 0;
        var failures = new List<AmenityIconMigrationFailure>();

        foreach (var mapping in Mappings)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var amenity = await dbContext.Amenities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(item => item.Slug == mapping.AmenitySlug, cancellationToken);
            if (amenity is null)
            {
                skippedCount++;
                logger.LogInformation(
                    "Amenity icon migration skipped missing amenity {AmenitySlug}.",
                    mapping.AmenitySlug);
                continue;
            }

            if (!string.Equals(amenity.Icon, mapping.ExpectedLegacyIcon, StringComparison.Ordinal))
            {
                skippedCount++;
                logger.LogInformation(
                    "Amenity icon migration skipped {AmenitySlug} because its icon is not the expected legacy path.",
                    mapping.AmenitySlug);
                continue;
            }

            string sanitizedSvg;
            var sourcePath = Path.Combine(
                environment.WebRootPath,
                "svgs",
                "amenities",
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
                    "Amenity icon migration source {SourceFileName} is missing for {AmenitySlug}.",
                    mapping.SourceFileName,
                    mapping.AmenitySlug);
                failures.Add(new(
                    mapping.AmenitySlug,
                    AmenityIconMigrationFailureStage.Source,
                    "The mapped source SVG is missing."));
                continue;
            }
            catch (SvgSanitizationException exception)
            {
                logger.LogError(
                    exception,
                    "Amenity icon migration sanitization failed for {AmenitySlug} with {Failure}.",
                    mapping.AmenitySlug,
                    exception.Failure);
                failures.Add(new(
                    mapping.AmenitySlug,
                    AmenityIconMigrationFailureStage.Sanitization,
                    "The mapped source SVG failed sanitization."));
                continue;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(
                    exception,
                    "Amenity icon migration could not read source {SourceFileName} for {AmenitySlug}.",
                    mapping.SourceFileName,
                    mapping.AmenitySlug);
                failures.Add(new(
                    mapping.AmenitySlug,
                    AmenityIconMigrationFailureStage.Source,
                    "The mapped source SVG could not be read."));
                continue;
            }

            StoredMediaAsset storedAsset;
            try
            {
                await using var content = new MemoryStream(Encoding.UTF8.GetBytes(sanitizedSvg));
                storedAsset = await mediaStorage.StoreSanitizedSvgAsync(
                    MediaAssetNamespace.Amenities,
                    amenity.Id,
                    content,
                    cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(
                    exception,
                    "Amenity icon migration storage failed for {AmenitySlug} and entity {EntityId}.",
                    mapping.AmenitySlug,
                    amenity.Id);
                failures.Add(new(
                    mapping.AmenitySlug,
                    AmenityIconMigrationFailureStage.Storage,
                    "The sanitized SVG could not be stored."));
                continue;
            }

            IDbContextTransaction? transaction = null;
            try
            {
                transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var updatedRows = await dbContext.Amenities
                    .IgnoreQueryFilters()
                    .Where(item =>
                        item.Id == amenity.Id &&
                        item.Slug == mapping.AmenitySlug &&
                        item.Icon == mapping.ExpectedLegacyIcon)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(item => item.Icon, storedAsset.PublicPath),
                        cancellationToken);

                if (updatedRows == 0)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    if (!await CompensateAsync(mapping.AmenitySlug, amenity.Id, storedAsset, failures))
                    {
                        continue;
                    }

                    skippedCount++;
                    logger.LogInformation(
                        "Amenity icon migration skipped {AmenitySlug} because its icon changed concurrently.",
                        mapping.AmenitySlug);
                    continue;
                }

                await transaction.CommitAsync(cancellationToken);
                migratedCount++;
                logger.LogInformation(
                    "Amenity icon migration completed for {AmenitySlug} and entity {EntityId}.",
                    mapping.AmenitySlug,
                    amenity.Id);
            }
            catch (Exception exception)
            {
                await RollbackAsync(transaction, mapping.AmenitySlug);
                if (exception is not OperationCanceledException)
                {
                    logger.LogError(
                        exception,
                        "Amenity icon migration database update failed for {AmenitySlug} and entity {EntityId}.",
                        mapping.AmenitySlug,
                        amenity.Id);
                    failures.Add(new(
                        mapping.AmenitySlug,
                        AmenityIconMigrationFailureStage.Database,
                        "The database icon update failed."));
                }

                await CompensateAsync(mapping.AmenitySlug, amenity.Id, storedAsset, failures);

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

        return new AmenityIconMigrationResult(migratedCount, skippedCount, failures);
    }

    private async Task<bool> CompensateAsync(
        string amenitySlug,
        int amenityId,
        StoredMediaAsset storedAsset,
        ICollection<AmenityIconMigrationFailure> failures)
    {
        try
        {
            var deleted = await mediaStorage.DeleteOwnedAssetAsync(
                MediaAssetNamespace.Amenities,
                amenityId,
                storedAsset.PublicPath,
                CancellationToken.None);
            if (deleted)
            {
                return true;
            }

            logger.LogError(
                "Amenity icon migration compensation could not find the owned asset for {AmenitySlug} and entity {EntityId}.",
                amenitySlug,
                amenityId);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Amenity icon migration compensation failed for {AmenitySlug} and entity {EntityId}.",
                amenitySlug,
                amenityId);
        }

        failures.Add(new(
            amenitySlug,
            AmenityIconMigrationFailureStage.Compensation,
            "The newly stored asset could not be removed after migration failure."));
        return false;
    }

    private async Task RollbackAsync(IDbContextTransaction? transaction, string amenitySlug)
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
                "Amenity icon migration database rollback failed for {AmenitySlug}.",
                amenitySlug);
        }
    }

    private sealed record MigrationMapping(
        string AmenitySlug,
        string ExpectedLegacyIcon,
        string SourceFileName);
}
