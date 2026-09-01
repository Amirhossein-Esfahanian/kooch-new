using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services.Amenities;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AmenityIconMigrationTests
{
    private const int CategoryId = 9001;
    private static readonly AmenitySeed[] Mappings =
    [
        new(137, "water", "/svgs/amenities/water.svg", "water.svg"),
        new(203, "gas", "/svgs/amenities/gas.svg", "gas.svg"),
        new(311, "wifi", "/svgs/amenities/wifi.svg", "wifi.svg")
    ];

    [Fact]
    public async Task AllKnownMappings_UseSlugExactLegacyPathSourceAndActualEntityId()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync(Mappings);

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(3, result.MigratedCount);
        Assert.Equal(0, result.SkippedCount);
        Assert.Empty(result.Failures);
        foreach (var mapping in Mappings)
        {
            var amenity = await harness.FindAmenityAsync(mapping.Slug);
            Assert.Matches(
                $"^/uploads/amenities/{mapping.Id}/[0-9a-f]{{32}}\\.svg$",
                amenity.Icon!);
            var storedPath = harness.GetPhysicalPath(amenity.Icon!);
            Assert.True(File.Exists(storedPath));
            await using var source = File.OpenRead(harness.GetSourcePath(mapping.SourceFile));
            var expectedSanitized = await new SvgSanitizer().SanitizeAsync(source);
            Assert.Equal(expectedSanitized, await File.ReadAllTextAsync(storedPath));
        }
    }

    [Theory]
    [InlineData("water", null)]
    [InlineData("water", "/uploads/amenities/137/0123456789abcdef0123456789abcdef.svg")]
    [InlineData("water", "custom-icon")]
    [InlineData("water", "/svgs/amenities/gas.svg")]
    [InlineData("custom-water", "/svgs/amenities/water.svg")]
    public async Task NonEligibleValues_ArePreservedExactly(string slug, string? icon)
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([new AmenitySeed(137, slug, icon, "water.svg")]);

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(0, result.MigratedCount);
        Assert.Equal(3, result.SkippedCount);
        Assert.Empty(result.Failures);
        Assert.Equal(icon, (await harness.FindAmenityAsync(slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task SecondRun_DoesNotRegenerateAlreadyMigratedAssets()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync(Mappings);

        var first = await harness.CreateMigration().MigrateAsync();
        var firstPaths = await harness.GetAmenityPathsAsync();
        var firstFileCount = harness.CountFinalAssets();
        var second = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(3, first.MigratedCount);
        Assert.Equal(0, second.MigratedCount);
        Assert.Equal(3, second.SkippedCount);
        Assert.Empty(second.Failures);
        Assert.Equal(firstPaths, await harness.GetAmenityPathsAsync());
        Assert.Equal(firstFileCount, harness.CountFinalAssets());
    }

    [Fact]
    public async Task PartialMigration_PreservesCanonicalRowsAndMigratesOnlyRemainingExactLegacyRows()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        var existing = await harness.StoreSourceAsync(Mappings[0]);
        await harness.AddAmenitiesAsync(
        [
            Mappings[0] with { LegacyIcon = existing.PublicPath },
            Mappings[1]
        ]);

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(1, result.MigratedCount);
        Assert.Equal(2, result.SkippedCount);
        Assert.Empty(result.Failures);
        Assert.Equal(existing.PublicPath, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Matches(
            $"^/uploads/amenities/{Mappings[1].Id}/[0-9a-f]{{32}}\\.svg$",
            (await harness.FindAmenityAsync(Mappings[1].Slug)).Icon!);
        Assert.Equal(2, harness.CountFinalAssets());
    }

    [Fact]
    public async Task MissingSource_LeavesLegacyPathAndCreatesNoAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync(copySources: false);
        await harness.AddAmenitiesAsync([Mappings[0]]);

        var result = await harness.CreateMigration().MigrateAsync();

        AssertFailure(result, AmenityIconMigrationFailureStage.Source);
        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task SanitizerFailure_LeavesLegacyPathAndCreatesNoAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);

        var result = await harness.CreateMigration(new ThrowingSanitizer()).MigrateAsync();

        AssertFailure(result, AmenityIconMigrationFailureStage.Sanitization);
        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task MediaStorageFailure_LeavesLegacyPathUnchanged()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            StoreOverride = (_, _, _, _) => throw new IOException("store failed")
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        AssertFailure(result, AmenityIconMigrationFailureStage.Storage);
        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task DatabaseFailure_RollsBackLegacyPathAndDeletesNewAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);
        await harness.FailIconUpdatesAsync();

        var result = await harness.CreateMigration().MigrateAsync();

        AssertFailure(result, AmenityIconMigrationFailureStage.Database);
        Assert.DoesNotContain(
            result.Failures,
            failure => failure.Stage == AmenityIconMigrationFailureStage.Compensation);
        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task CompensationFailure_IsSurfacedWithoutChangingDatabaseValue()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);
        await harness.FailIconUpdatesAsync();
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            DeleteOverride = (_, _, _, _) => throw new IOException("cleanup failed")
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        AssertFailure(result, AmenityIconMigrationFailureStage.Database);
        Assert.Contains(
            result.Failures,
            failure => failure.Stage == AmenityIconMigrationFailureStage.Compensation);
        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(1, harness.CountFinalAssets());
    }

    [Fact]
    public async Task ConcurrentAdminChange_WinsAndNewAssetIsCompensated()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);
        const string adminIcon = "/uploads/amenities/137/fedcba9876543210fedcba9876543210.svg";
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            AfterStore = async () =>
            {
                await using var concurrentContext = harness.CreateContext();
                var amenity = await concurrentContext.Amenities
                    .SingleAsync(item => item.Slug == "water");
                amenity.Icon = adminIcon;
                await concurrentContext.SaveChangesAsync();
            }
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        Assert.Equal(0, result.MigratedCount);
        Assert.Equal(3, result.SkippedCount);
        Assert.Empty(result.Failures);
        Assert.Equal(adminIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task CancellationAfterStorage_CompensatesAssetAndLeavesLegacyPathUnchanged()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddAmenitiesAsync([Mappings[0]]);
        using var cancellation = new CancellationTokenSource();
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            AfterStore = () =>
            {
                cancellation.Cancel();
                return Task.CompletedTask;
            }
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => harness.CreateMigration(mediaStorage: storage).MigrateAsync(cancellation.Token));

        Assert.Equal(Mappings[0].LegacyIcon, (await harness.FindAmenityAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    private static void AssertFailure(
        AmenityIconMigrationResult result,
        AmenityIconMigrationFailureStage stage)
    {
        Assert.Equal(0, result.MigratedCount);
        Assert.Contains(result.Failures, failure => failure.Stage == stage);
    }

    private static Amenity CreateAmenity(AmenitySeed seed) => new()
    {
        Id = seed.Id,
        AmenityCategoryId = CategoryId,
        Name = seed.Slug,
        Slug = seed.Slug,
        Icon = seed.LegacyIcon,
        Scope = AmenityScope.Both,
        SortOrder = seed.Id
    };

    private sealed record AmenitySeed(int Id, string Slug, string? LegacyIcon, string SourceFile);

    private sealed class MigrationHarness : IAsyncDisposable
    {
        private readonly TemporaryDirectory temp;
        private readonly SqliteConnection connection;

        private MigrationHarness(
            TemporaryDirectory temp,
            SqliteConnection connection,
            KoochDbContext dbContext,
            TestWebHostEnvironment environment,
            FileSystemMediaStorage storage)
        {
            this.temp = temp;
            this.connection = connection;
            DbContext = dbContext;
            Environment = environment;
            Storage = storage;
        }

        public KoochDbContext DbContext { get; }
        public TestWebHostEnvironment Environment { get; }
        public FileSystemMediaStorage Storage { get; }

        public static async Task<MigrationHarness> CreateAsync(bool copySources = true)
        {
            var temp = new TemporaryDirectory();
            var contentRoot = Path.Combine(temp.Path, "repo", "backend", "Kooch.Api");
            var webRoot = Path.Combine(contentRoot, "wwwroot");
            Directory.CreateDirectory(webRoot);
            var environment = new TestWebHostEnvironment
            {
                ApplicationName = "Kooch.Api.Tests",
                EnvironmentName = "Testing",
                ContentRootPath = contentRoot,
                ContentRootFileProvider = new PhysicalFileProvider(contentRoot),
                WebRootPath = webRoot,
                WebRootFileProvider = new PhysicalFileProvider(webRoot)
            };
            if (copySources)
            {
                var destination = Path.Combine(webRoot, "svgs", "amenities");
                Directory.CreateDirectory(destination);
                foreach (var mapping in Mappings)
                {
                    File.Copy(
                        Path.Combine(FindFixtureRoot(), mapping.SourceFile),
                        Path.Combine(destination, mapping.SourceFile));
                }
            }

            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var dbContext = CreateContext(connection);
            await dbContext.Database.EnsureCreatedAsync();
            dbContext.AmenityCategories.Add(new AmenityCategory
            {
                Id = CategoryId,
                Name = "Migration test category",
                Slug = "migration-test-category",
                IsActive = true
            });
            await dbContext.SaveChangesAsync();
            dbContext.ChangeTracker.Clear();
            var storage = new FileSystemMediaStorage(
                Options.Create(new MediaStorageOptions
                {
                    RootPath = "../../media-root",
                    PublicBasePath = "/uploads",
                    StagingLifetimeHours = 24
                }),
                environment);
            return new MigrationHarness(temp, connection, dbContext, environment, storage);
        }

        public KoochDbContext CreateContext() => CreateContext(connection);

        public AmenityIconMigration CreateMigration(
            ISvgSanitizer? sanitizer = null,
            IMediaStorage? mediaStorage = null) =>
            new(
                DbContext,
                Environment,
                sanitizer ?? new SvgSanitizer(),
                mediaStorage ?? Storage,
                NullLogger<AmenityIconMigration>.Instance);

        public async Task AddAmenitiesAsync(IEnumerable<AmenitySeed> mappings)
        {
            DbContext.Amenities.AddRange(mappings.Select(CreateAmenity));
            await DbContext.SaveChangesAsync();
            DbContext.ChangeTracker.Clear();
        }

        public async Task<Amenity> FindAmenityAsync(string slug)
        {
            DbContext.ChangeTracker.Clear();
            return await DbContext.Amenities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync(item => item.Slug == slug);
        }

        public async Task<Dictionary<string, string?>> GetAmenityPathsAsync()
        {
            DbContext.ChangeTracker.Clear();
            return await DbContext.Amenities
                .AsNoTracking()
                .ToDictionaryAsync(item => item.Slug, item => item.Icon);
        }

        public int CountFinalAssets()
        {
            var root = Path.Combine(Storage.RootPath, "amenities");
            return Directory.Exists(root)
                ? Directory.GetFiles(root, "*.svg", SearchOption.AllDirectories).Length
                : 0;
        }

        public string GetPhysicalPath(string publicPath)
        {
            var relative = publicPath[(Storage.PublicBasePath.Length + 1)..]
                .Replace('/', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(Storage.RootPath, relative));
        }

        public string GetSourcePath(string fileName) =>
            Path.Combine(Environment.WebRootPath, "svgs", "amenities", fileName);

        public async Task<StoredMediaAsset> StoreSourceAsync(AmenitySeed mapping)
        {
            await using var source = File.OpenRead(GetSourcePath(mapping.SourceFile));
            var sanitized = await new SvgSanitizer().SanitizeAsync(source);
            await using var content = new MemoryStream(Encoding.UTF8.GetBytes(sanitized));
            return await Storage.StoreSanitizedSvgAsync(
                MediaAssetNamespace.Amenities,
                mapping.Id,
                content);
        }

        public Task FailIconUpdatesAsync() =>
            DbContext.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER FailAmenityIconUpdate
                BEFORE UPDATE OF Icon ON Amenities
                BEGIN
                    SELECT RAISE(ABORT, 'icon update failed');
                END;
                """);

        public async ValueTask DisposeAsync()
        {
            await DbContext.DisposeAsync();
            await connection.DisposeAsync();
            temp.Dispose();
        }

        private static KoochDbContext CreateContext(SqliteConnection connection)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            return new KoochDbContext(options);
        }

        private static string FindFixtureRoot()
        {
            var root = Path.Combine(
                AppContext.BaseDirectory,
                "SvgCompatibilityFixtures",
                "amenities");
            return Directory.Exists(root)
                ? root
                : throw new DirectoryNotFoundException("SVG compatibility fixtures were not copied.");
        }
    }

    private sealed class DelegatingMediaStorage(IMediaStorage inner) : IMediaStorage
    {
        public Func<MediaAssetNamespace, int, Stream, CancellationToken, Task<StoredMediaAsset>>? StoreOverride { get; init; }
        public Func<MediaAssetNamespace, int, string?, CancellationToken, Task<bool>>? DeleteOverride { get; init; }
        public Func<Task>? AfterStore { get; init; }
        public string RootPath => inner.RootPath;
        public string PublicBasePath => inner.PublicBasePath;
        public void Initialize() => inner.Initialize();

        public async Task<StoredMediaAsset> StoreSanitizedSvgAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            Stream sanitizedSvgContent,
            CancellationToken cancellationToken = default)
        {
            var asset = StoreOverride is null
                ? await inner.StoreSanitizedSvgAsync(assetNamespace, entityId, sanitizedSvgContent, cancellationToken)
                : await StoreOverride(assetNamespace, entityId, sanitizedSvgContent, cancellationToken);
            if (AfterStore is not null)
            {
                await AfterStore();
            }
            return asset;
        }

        public Task<bool> DeleteOwnedAssetAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            string? publicPath,
            CancellationToken cancellationToken = default) =>
            DeleteOverride is null
                ? inner.DeleteOwnedAssetAsync(assetNamespace, entityId, publicPath, cancellationToken)
                : DeleteOverride(assetNamespace, entityId, publicPath, cancellationToken);

        public Task<StagedMediaAsset> StageSanitizedSvgAsync(
            MediaAssetNamespace assetNamespace,
            string sanitizedSvg,
            CancellationToken cancellationToken = default) =>
            inner.StageSanitizedSvgAsync(assetNamespace, sanitizedSvg, cancellationToken);

        public Task<StoredMediaAsset> FinalizeStagedSvgAsync(
            MediaAssetNamespace assetNamespace,
            string uploadToken,
            int entityId,
            CancellationToken cancellationToken = default) =>
            inner.FinalizeStagedSvgAsync(assetNamespace, uploadToken, entityId, cancellationToken);

        public Task<int> CleanupExpiredStagedAssetsAsync(CancellationToken cancellationToken = default) =>
            inner.CleanupExpiredStagedAssetsAsync(cancellationToken);
    }

    private sealed class ThrowingSanitizer : ISvgSanitizer
    {
        public Task<string> SanitizeAsync(Stream input, CancellationToken cancellationToken = default) =>
            throw new SvgSanitizationException(
                SvgSanitizationFailure.UnsupportedStructure,
                "test sanitization failure");
    }

    private sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = string.Empty;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = string.Empty;
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                $"kooch-amenity-icon-migration-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
