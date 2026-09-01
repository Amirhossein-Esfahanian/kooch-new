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

public sealed class AmenityCategoryIconMigrationTests
{
    private static readonly CategorySeed[] Mappings =
    [
        new(137, "base-services", "utilities", "base-services.svg"),
        new(203, "health-bathroom", "bath", "health-bathroom.svg"),
        new(311, "kitchen", "kitchen", "kitchen.svg"),
        new(419, "comfort-welfare", "sofa", "comfort-welfare.svg"),
        new(523, "entertainment", "gamepad", "entertainment.svg"),
        new(631, "safety", "shield", "safety.svg"),
        new(743, "environment", "garden", "environment.svg"),
        new(857, "exclusive-features", "star", "exclusive-features.svg")
    ];

    [Fact]
    public async Task AllKnownMappings_UseSlugSourceAndActualEntityId()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync(Mappings);

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(8, result.MigratedCount);
        Assert.Equal(0, result.SkippedCount);
        Assert.Empty(result.Failures);
        foreach (var mapping in Mappings)
        {
            var category = await harness.FindCategoryAsync(mapping.Slug);
            Assert.Matches(
                $"^/uploads/amenity-categories/{mapping.Id}/[0-9a-f]{{32}}\\.svg$",
                category.Icon!);
            var storedPath = harness.GetPhysicalPath(category.Icon!);
            Assert.True(File.Exists(storedPath));
            await using var source = File.OpenRead(harness.GetSourcePath(mapping.SourceFile));
            var expectedSanitized = await new SvgSanitizer().SanitizeAsync(source);
            Assert.Equal(expectedSanitized, await File.ReadAllTextAsync(storedPath));
            Assert.NotEqual(mapping.Symbol, category.Icon);
        }
    }

    [Fact]
    public async Task AdminManagedAndNonEligibleValues_ArePreservedExactly()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        var categories = new[]
        {
            Category(137, "base-services", "/uploads/amenity-categories/137/0123456789abcdef0123456789abcdef.svg"),
            Category(203, "health-bathroom", "/svgs/amenity-categories/health-bathroom.svg"),
            Category(311, "kitchen", null),
            Category(419, "comfort-welfare", "custom-icon"),
            Category(523, "entertainment", "shield"),
            Category(991, "custom-category", "utilities")
        };
        harness.DbContext.AmenityCategories.AddRange(categories);
        await harness.DbContext.SaveChangesAsync();
        var expected = categories.ToDictionary(item => item.Slug, item => item.Icon);

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(0, result.MigratedCount);
        Assert.Equal(8, result.SkippedCount);
        Assert.Empty(result.Failures);
        foreach (var item in expected)
        {
            Assert.Equal(item.Value, (await harness.FindCategoryAsync(item.Key)).Icon);
        }
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task SecondRun_DoesNotRegenerateAlreadyMigratedAssets()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync(Mappings);

        var first = await harness.CreateMigration().MigrateAsync();
        var firstPaths = await harness.GetCategoryPathsAsync();
        var firstFileCount = harness.CountFinalAssets();
        var second = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(8, first.MigratedCount);
        Assert.Equal(0, second.MigratedCount);
        Assert.Equal(8, second.SkippedCount);
        Assert.Empty(second.Failures);
        Assert.Equal(firstPaths, await harness.GetCategoryPathsAsync());
        Assert.Equal(firstFileCount, harness.CountFinalAssets());
    }

    [Fact]
    public async Task PartialMigration_PreservesCanonicalRowsAndMigratesRemainingSymbols()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        var existing = await harness.StoreSourceAsync(Mappings[0]);
        harness.DbContext.AmenityCategories.AddRange(
            Category(Mappings[0].Id, Mappings[0].Slug, existing.PublicPath),
            Category(Mappings[1].Id, Mappings[1].Slug, Mappings[1].Symbol));
        await harness.DbContext.SaveChangesAsync();

        var result = await harness.CreateMigration().MigrateAsync();

        Assert.Equal(1, result.MigratedCount);
        Assert.Equal(7, result.SkippedCount);
        Assert.Empty(result.Failures);
        Assert.Equal(existing.PublicPath, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Matches(
            $"^/uploads/amenity-categories/{Mappings[1].Id}/[0-9a-f]{{32}}\\.svg$",
            (await harness.FindCategoryAsync(Mappings[1].Slug)).Icon!);
        Assert.Equal(2, harness.CountFinalAssets());
    }

    [Fact]
    public async Task MissingSource_LeavesSymbolAndCreatesNoAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync(copySources: false);
        await harness.AddCategoriesAsync([Mappings[0]]);

        var result = await harness.CreateMigration().MigrateAsync();

        AssertFailure(result, AmenityCategoryIconMigrationFailureStage.Source);
        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task SanitizerFailure_LeavesSymbolAndCreatesNoAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);

        var result = await harness.CreateMigration(new ThrowingSanitizer()).MigrateAsync();

        AssertFailure(result, AmenityCategoryIconMigrationFailureStage.Sanitization);
        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task MediaStorageFailure_LeavesSymbolUnchanged()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            StoreOverride = (_, _, _, _) => throw new IOException("store failed")
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        AssertFailure(result, AmenityCategoryIconMigrationFailureStage.Storage);
        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task DatabaseFailure_RollsBackSymbolAndDeletesNewAsset()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);
        await harness.FailIconUpdatesAsync();

        var result = await harness.CreateMigration().MigrateAsync();

        AssertFailure(result, AmenityCategoryIconMigrationFailureStage.Database);
        Assert.DoesNotContain(
            result.Failures,
            failure => failure.Stage == AmenityCategoryIconMigrationFailureStage.Compensation);
        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task CompensationFailure_IsSurfacedWithoutChangingDatabaseValue()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);
        await harness.FailIconUpdatesAsync();
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            DeleteOverride = (_, _, _, _) => throw new IOException("cleanup failed")
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        AssertFailure(result, AmenityCategoryIconMigrationFailureStage.Database);
        Assert.Contains(
            result.Failures,
            failure => failure.Stage == AmenityCategoryIconMigrationFailureStage.Compensation);
        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
    }

    [Fact]
    public async Task ConcurrentAdminChange_WinsAndNewAssetIsCompensated()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);
        const string adminIcon = "/uploads/amenity-categories/137/fedcba9876543210fedcba9876543210.svg";
        var storage = new DelegatingMediaStorage(harness.Storage)
        {
            AfterStore = async () =>
            {
                await using var concurrentContext = harness.CreateContext();
                var category = await concurrentContext.AmenityCategories
                    .SingleAsync(item => item.Slug == "base-services");
                category.Icon = adminIcon;
                await concurrentContext.SaveChangesAsync();
            }
        };

        var result = await harness.CreateMigration(mediaStorage: storage).MigrateAsync();

        Assert.Equal(0, result.MigratedCount);
        Assert.Equal(8, result.SkippedCount);
        Assert.Empty(result.Failures);
        Assert.Equal(adminIcon, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    [Fact]
    public async Task CancellationAfterStorage_CompensatesAssetAndLeavesSymbolUnchanged()
    {
        await using var harness = await MigrationHarness.CreateAsync();
        await harness.AddCategoriesAsync([Mappings[0]]);
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

        Assert.Equal(Mappings[0].Symbol, (await harness.FindCategoryAsync(Mappings[0].Slug)).Icon);
        Assert.Equal(0, harness.CountFinalAssets());
    }

    private static void AssertFailure(
        AmenityCategoryIconMigrationResult result,
        AmenityCategoryIconMigrationFailureStage stage)
    {
        Assert.Equal(0, result.MigratedCount);
        Assert.Contains(result.Failures, failure => failure.Stage == stage);
    }

    private static AmenityCategory Category(int id, string slug, string? icon) => new()
    {
        Id = id,
        Name = slug,
        Slug = slug,
        SortOrder = id,
        Icon = icon,
        IsActive = true
    };

    private sealed record CategorySeed(int Id, string Slug, string Symbol, string SourceFile);

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
                var destination = Path.Combine(webRoot, "svgs", "amenity-categories");
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

        public AmenityCategoryIconMigration CreateMigration(
            ISvgSanitizer? sanitizer = null,
            IMediaStorage? mediaStorage = null) =>
            new(
                DbContext,
                Environment,
                sanitizer ?? new SvgSanitizer(),
                mediaStorage ?? Storage,
                NullLogger<AmenityCategoryIconMigration>.Instance);

        public async Task AddCategoriesAsync(IEnumerable<CategorySeed> mappings)
        {
            DbContext.AmenityCategories.AddRange(
                mappings.Select(mapping => Category(mapping.Id, mapping.Slug, mapping.Symbol)));
            await DbContext.SaveChangesAsync();
            DbContext.ChangeTracker.Clear();
        }

        public async Task<AmenityCategory> FindCategoryAsync(string slug)
        {
            DbContext.ChangeTracker.Clear();
            return await DbContext.AmenityCategories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync(item => item.Slug == slug);
        }

        public async Task<Dictionary<string, string?>> GetCategoryPathsAsync()
        {
            DbContext.ChangeTracker.Clear();
            return await DbContext.AmenityCategories
                .AsNoTracking()
                .ToDictionaryAsync(item => item.Slug, item => item.Icon);
        }

        public int CountFinalAssets()
        {
            var root = Path.Combine(Storage.RootPath, "amenity-categories");
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
            Path.Combine(Environment.WebRootPath, "svgs", "amenity-categories", fileName);

        public async Task<StoredMediaAsset> StoreSourceAsync(CategorySeed mapping)
        {
            await using var source = File.OpenRead(GetSourcePath(mapping.SourceFile));
            var sanitized = await new SvgSanitizer().SanitizeAsync(source);
            await using var content = new MemoryStream(Encoding.UTF8.GetBytes(sanitized));
            return await Storage.StoreSanitizedSvgAsync(
                MediaAssetNamespace.AmenityCategories,
                mapping.Id,
                content);
        }

        public Task FailIconUpdatesAsync() =>
            DbContext.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER FailAmenityCategoryIconUpdate
                BEFORE UPDATE OF Icon ON AmenityCategories
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
                "amenity-categories");
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
                $"kooch-category-icon-migration-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
