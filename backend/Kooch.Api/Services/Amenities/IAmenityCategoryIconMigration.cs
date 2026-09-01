namespace Kooch.Api.Services.Amenities;

public interface IAmenityCategoryIconMigration
{
    Task<AmenityCategoryIconMigrationResult> MigrateAsync(
        CancellationToken cancellationToken = default);
}

public sealed record AmenityCategoryIconMigrationResult(
    int MigratedCount,
    int SkippedCount,
    IReadOnlyList<AmenityCategoryIconMigrationFailure> Failures)
{
    public int FailedCount => Failures.Count;
}

public sealed record AmenityCategoryIconMigrationFailure(
    string CategorySlug,
    AmenityCategoryIconMigrationFailureStage Stage,
    string Message);

public enum AmenityCategoryIconMigrationFailureStage
{
    Source,
    Sanitization,
    Storage,
    Database,
    Compensation
}
