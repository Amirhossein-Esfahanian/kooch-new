namespace Kooch.Api.Services.Amenities;

public interface IAmenityIconMigration
{
    Task<AmenityIconMigrationResult> MigrateAsync(
        CancellationToken cancellationToken = default);
}

public sealed record AmenityIconMigrationResult(
    int MigratedCount,
    int SkippedCount,
    IReadOnlyList<AmenityIconMigrationFailure> Failures)
{
    public int FailedCount => Failures.Count;
}

public sealed record AmenityIconMigrationFailure(
    string AmenitySlug,
    AmenityIconMigrationFailureStage Stage,
    string Message);

public enum AmenityIconMigrationFailureStage
{
    Source,
    Sanitization,
    Storage,
    Database,
    Compensation
}
