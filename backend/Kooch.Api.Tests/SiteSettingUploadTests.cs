using System.Security.Claims;
using System.Text;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Services.MediaStorage;
using Kooch.Api.Services.SiteSettings;
using Kooch.Api.Services.Svg;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SiteSettingUploadTests
{
    private const string LogoKey = "site.logoUrl";
    private const string HeroKey = "home.heroBackgroundUrl";
    private const string SafeSvg =
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0h1v1H0z\"/></svg>";

    [Fact]
    public async Task Upload_AdminAssistantWithoutManageSettings_IsRejectedBeforeServiceCall()
    {
        await using var database = await TestDatabase.CreateAsync();
        var uploadService = new StubUploadService();
        var controller = ConfigureController(
            new AdminSiteSettingsController(database.Context, new DenyPermissionService(), uploadService),
            UserRole.AdminAssistant);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Upload(CreateFormFile([1], "logo.png"), LogoKey, CancellationToken.None));

        Assert.Equal(0, uploadService.CallCount);
    }

    [Fact]
    public async Task Upload_AdminAssistantWithManageSettings_UsesCanonicalServiceAndResponseContract()
    {
        await using var database = await TestDatabase.CreateAsync();
        var expected = await database.SeedSettingAsync(LogoKey, "/uploads/site-settings/1/existing.png");
        var uploadService = new StubUploadService(expected);
        var controller = ConfigureController(
            new AdminSiteSettingsController(database.Context, new AllowPermissionService(), uploadService),
            UserRole.AdminAssistant);

        var response = await controller.Upload(
            CreateFormFile([1], "logo.png"),
            LogoKey,
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(response.Result);
        var setting = Assert.IsType<Kooch.Api.Dtos.SiteSettings.SiteSettingResponse>(ok.Value);
        Assert.Equal(LogoKey, setting.Key);
        Assert.Equal(expected.Value, setting.Value);
        Assert.Equal(1, uploadService.CallCount);
    }

    [Fact]
    public async Task Upload_UnsupportedKey_IsRejectedWithoutMutationOrAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                "site.footerText",
                CreateFormFile([1], "logo.png"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_MissingSetting_PreservesExistingNotFoundBehavior()
    {
        await using var database = await TestDatabase.CreateAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile([1], "logo.png"),
                CancellationToken.None));

        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_OverFiveMiB_IsRejectedBeforeStorage()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(new byte[5 * 1024 * 1024 + 1], "logo.png"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_UnsupportedExtension_IsRejectedBeforeStorage()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");
        var png = await CreateRasterAsync(".png");

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(png, "logo.gif"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_UndecodableRaster_IsRejectedBeforeStorage()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(Encoding.UTF8.GetBytes("not an image"), "logo.png"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Theory]
    [InlineData(".png", ".jpg")]
    [InlineData(".jpg", ".png")]
    [InlineData(".webp", ".jpeg")]
    public async Task Upload_RasterContentMustMatchExtension(string actualExtension, string claimedExtension)
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");
        var bytes = await CreateRasterAsync(actualExtension);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(bytes, $"logo{claimedExtension}"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_SvgRenamedAsWebp_IsRejectedBeforeStorage()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(Encoding.UTF8.GetBytes(SafeSvg), "logo.webp"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Theory]
    [InlineData(".png")]
    [InlineData(".jpg")]
    [InlineData(".jpeg")]
    [InlineData(".webp")]
    public async Task Upload_ValidLogoRaster_PersistsCanonicalOwnedAsset(string extension)
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");
        var bytes = await CreateRasterAsync(extension);

        var updated = await database.CreateService().UploadAsync(
            LogoKey,
            CreateFormFile(bytes, $"logo{extension}"),
            CancellationToken.None);

        Assert.Same(setting, updated);
        Assert.Matches(
            $"^/uploads/site-settings/{setting.Id}/[0-9a-f]{{32}}\\{extension}$",
            updated.Value);
        Assert.Equal(updated.Value, await database.PersistedValueAsync(LogoKey));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(database.GetFinalPath(updated.Value)));
    }

    [Fact]
    public async Task Upload_SafeLogoSvg_IsSanitizedBeforeCanonicalStorage()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, string.Empty);
        const string input =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\">\n  <path fill=\"#000\" d=\"M0 0h1v1H0z\"/>\n</svg>";

        var updated = await database.CreateService().UploadAsync(
            LogoKey,
            CreateFormFile(Encoding.UTF8.GetBytes(input), "logo.svg", "image/svg+xml"),
            CancellationToken.None);

        var expected = await new SvgSanitizer().SanitizeAsync(
            new MemoryStream(Encoding.UTF8.GetBytes(input)));
        Assert.Matches(
            $"^/uploads/site-settings/{setting.Id}/[0-9a-f]{{32}}\\.svg$",
            updated.Value);
        Assert.Equal(expected, await File.ReadAllTextAsync(database.GetFinalPath(updated.Value)));
        Assert.NotEqual(input, await File.ReadAllTextAsync(database.GetFinalPath(updated.Value)));
    }

    [Fact]
    public async Task Upload_UnsafeLogoSvg_IsRejectedWithoutMutationOrAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, "/images/logo.png");
        const string unsafeSvg =
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><script>alert(1)</script></svg>";

        await Assert.ThrowsAsync<SvgSanitizationException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(Encoding.UTF8.GetBytes(unsafeSvg), "logo.svg", "image/svg+xml"),
                CancellationToken.None));

        Assert.Equal("/images/logo.png", setting.Value);
        Assert.Empty(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_ValidHeroRaster_SucceedsButHeroSvgIsRejected()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(HeroKey, "/images/hero.jpg");
        var png = await CreateRasterAsync(".png");

        var updated = await database.CreateService().UploadAsync(
            HeroKey,
            CreateFormFile(png, "hero.png"),
            CancellationToken.None);

        Assert.Matches(
            $"^/uploads/site-settings/{setting.Id}/[0-9a-f]{{32}}\\.png$",
            updated.Value);
        var persistedAfterRaster = updated.Value;

        await Assert.ThrowsAsync<ArgumentException>(() =>
            database.CreateService().UploadAsync(
                HeroKey,
                CreateFormFile(Encoding.UTF8.GetBytes(SafeSvg), "hero.svg", "image/svg+xml"),
                CancellationToken.None));

        Assert.Equal(persistedAfterRaster, await database.PersistedValueAsync(HeroKey));
        Assert.Single(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_SuccessfulReplacementDeletesPreviousCanonicalOwnedAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, string.Empty);
        var oldAsset = await database.StoreRasterAsync(setting.Id, ".png");
        setting.Value = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var oldPath = database.GetFinalPath(oldAsset.PublicPath);

        var updated = await database.CreateService().UploadAsync(
            LogoKey,
            CreateFormFile(await CreateRasterAsync(".webp"), "logo.webp"),
            CancellationToken.None);

        Assert.False(File.Exists(oldPath));
        Assert.True(File.Exists(database.GetFinalPath(updated.Value)));
        Assert.Single(database.FinalAssets());
    }

    [Theory]
    [InlineData("/uploads/site/legacy.png")]
    [InlineData("https://cdn.example.test/logo.png")]
    [InlineData("/images/default-logo.png")]
    public async Task Upload_ReplacementNeverDeletesLegacyExternalOrDefaultOldValue(string previousValue)
    {
        await using var database = await TestDatabase.CreateAsync();
        await database.SeedSettingAsync(LogoKey, previousValue);
        var legacyFile = database.CreateLegacyFile(previousValue);

        var updated = await database.CreateService().UploadAsync(
            LogoKey,
            CreateFormFile(await CreateRasterAsync(".png"), "logo.png"),
            CancellationToken.None);

        Assert.StartsWith("/uploads/site-settings/", updated.Value, StringComparison.Ordinal);
        if (legacyFile is not null)
        {
            Assert.True(File.Exists(legacyFile));
        }
    }

    [Fact]
    public async Task Upload_StorageFailureLeavesDatabaseAndOldAssetUnchanged()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, string.Empty);
        var oldAsset = await database.StoreRasterAsync(setting.Id, ".png");
        setting.Value = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var failingStorage = new DelegatingMediaStorage(database.Storage) { FailRasterStore = true };
        var replacement = await CreateRasterAsync(".webp");

        await Assert.ThrowsAsync<IOException>(() =>
            database.CreateService(failingStorage).UploadAsync(
                LogoKey,
                CreateFormFile(replacement, "logo.webp"),
                CancellationToken.None));

        Assert.Equal(oldAsset.PublicPath, await database.PersistedValueAsync(LogoKey));
        Assert.True(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
        Assert.Single(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_DatabaseFailureCompensatesNewAssetAndPreservesOldValueAndAsset()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, string.Empty);
        var oldAsset = await database.StoreRasterAsync(setting.Id, ".png");
        setting.Value = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        database.Context.FailNextSave();
        var replacement = await CreateRasterAsync(".webp");

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            database.CreateService().UploadAsync(
                LogoKey,
                CreateFormFile(replacement, "logo.webp"),
                CancellationToken.None));

        Assert.Equal(oldAsset.PublicPath, await database.PersistedValueAsync(LogoKey));
        Assert.True(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
        Assert.Single(database.FinalAssets());
    }

    [Fact]
    public async Task Upload_OldAssetCleanupFailureDoesNotUndoCommittedReplacement()
    {
        await using var database = await TestDatabase.CreateAsync();
        var setting = await database.SeedSettingAsync(LogoKey, string.Empty);
        var oldAsset = await database.StoreRasterAsync(setting.Id, ".png");
        setting.Value = oldAsset.PublicPath;
        await database.Context.SaveChangesAsync();
        var cleanupFailingStorage = new DelegatingMediaStorage(database.Storage)
        {
            DeleteFailurePath = oldAsset.PublicPath
        };

        var updated = await database.CreateService(cleanupFailingStorage).UploadAsync(
            LogoKey,
            CreateFormFile(await CreateRasterAsync(".webp"), "logo.webp"),
            CancellationToken.None);

        Assert.Equal(updated.Value, await database.PersistedValueAsync(LogoKey));
        Assert.True(File.Exists(database.GetFinalPath(updated.Value)));
        Assert.True(File.Exists(database.GetFinalPath(oldAsset.PublicPath)));
        Assert.Equal(2, database.FinalAssets().Length);
    }

    private static TController ConfigureController<TController>(TController controller, UserRole role)
        where TController : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, "1"),
                        new Claim(ClaimTypes.Role, role.ToString())
                    ],
                    "SiteSettingUploadTests"))
            }
        };
        return controller;
    }

    private static FormFile CreateFormFile(byte[] content, string fileName, string contentType = "ignored/client-value")
    {
        var stream = new MemoryStream(content);
        return new FormFile(stream, 0, content.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    private static async Task<byte[]> CreateRasterAsync(string extension)
    {
        using var image = new Image<Rgba32>(2, 2, new Rgba32(10, 20, 30, 255));
        await using var output = new MemoryStream();
        switch (extension.ToLowerInvariant())
        {
            case ".png":
                await image.SaveAsPngAsync(output);
                break;
            case ".jpg":
            case ".jpeg":
                await image.SaveAsJpegAsync(output);
                break;
            case ".webp":
                await image.SaveAsWebpAsync(output);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(extension));
        }

        return output.ToArray();
    }

    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly TemporaryDirectory temp;
        private readonly SqliteConnection connection;
        private readonly DbContextOptions<KoochDbContext> options;

        private TestDatabase(
            TemporaryDirectory temp,
            SqliteConnection connection,
            DbContextOptions<KoochDbContext> options,
            FailingKoochDbContext context,
            TestWebHostEnvironment environment,
            FileSystemMediaStorage storage)
        {
            this.temp = temp;
            this.connection = connection;
            this.options = options;
            Context = context;
            Environment = environment;
            Storage = storage;
        }

        public FailingKoochDbContext Context { get; }
        public TestWebHostEnvironment Environment { get; }
        public FileSystemMediaStorage Storage { get; }

        public static async Task<TestDatabase> CreateAsync()
        {
            var temp = new TemporaryDirectory();
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite(connection)
                .Options;
            var context = new FailingKoochDbContext(options);
            await context.Database.EnsureCreatedAsync();
            var environment = CreateEnvironment(temp.Path);
            var storage = new FileSystemMediaStorage(
                Options.Create(new MediaStorageOptions
                {
                    RootPath = "../../media-root",
                    PublicBasePath = "/uploads",
                    StagingLifetimeHours = 24
                }),
                environment);
            return new TestDatabase(temp, connection, options, context, environment, storage);
        }

        public SiteSettingUploadService CreateService(IMediaStorage? storage = null) =>
            new(
                Context,
                storage ?? Storage,
                new SvgSanitizer(),
                NullLogger<SiteSettingUploadService>.Instance);

        public async Task<SiteSetting> SeedSettingAsync(string key, string value)
        {
            var setting = new SiteSetting
            {
                Key = key,
                Value = value,
                Type = SiteSettingType.ImageUrl,
                Group = "Brand",
                Label = key,
                IsActive = true
            };
            Context.SiteSettings.Add(setting);
            await Context.SaveChangesAsync();
            return setting;
        }

        public async Task<StoredMediaAsset> StoreRasterAsync(int settingId, string extension)
        {
            await using var content = new MemoryStream(await CreateRasterAsync(extension));
            return await Storage.StoreValidatedRasterAsync(
                MediaAssetNamespace.SiteSettings,
                settingId,
                extension,
                content);
        }

        public string[] FinalAssets() => Directory.Exists(Storage.RootPath)
            ? Directory.GetFiles(
                Path.Combine(Storage.RootPath, "site-settings"),
                "*",
                SearchOption.AllDirectories)
            : [];

        public string GetFinalPath(string publicPath)
        {
            var relative = publicPath[(Storage.PublicBasePath.Length + 1)..]
                .Replace('/', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(Storage.RootPath, relative));
        }

        public string? CreateLegacyFile(string value)
        {
            if (!value.StartsWith("/uploads/site/", StringComparison.Ordinal))
            {
                return null;
            }

            var path = Path.Combine(Environment.WebRootPath, value.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, [1, 2, 3]);
            return path;
        }

        public async Task<string> PersistedValueAsync(string key)
        {
            await using var verificationContext = new KoochDbContext(options);
            return await verificationContext.SiteSettings.AsNoTracking()
                .Where(setting => setting.Key == key)
                .Select(setting => setting.Value)
                .SingleAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
            temp.Dispose();
        }

        private static TestWebHostEnvironment CreateEnvironment(string tempRoot)
        {
            var contentRoot = Path.Combine(tempRoot, "repo", "backend", "Kooch.Api");
            var webRoot = Path.Combine(contentRoot, "wwwroot");
            Directory.CreateDirectory(webRoot);
            return new TestWebHostEnvironment
            {
                ApplicationName = "Kooch.Api.Tests",
                EnvironmentName = "Testing",
                ContentRootPath = contentRoot,
                WebRootPath = webRoot
            };
        }
    }

    private sealed class FailingKoochDbContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        private bool failNextSave;

        public void FailNextSave() => failNextSave = true;

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (failNextSave)
            {
                failNextSave = false;
                throw new DbUpdateException("Simulated database write failure.");
            }

            return base.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed class DelegatingMediaStorage(IMediaStorage inner) : IMediaStorage
    {
        public bool FailRasterStore { get; init; }
        public string? DeleteFailurePath { get; init; }
        public string RootPath => inner.RootPath;
        public string PublicBasePath => inner.PublicBasePath;

        public void Initialize() => inner.Initialize();

        public Task<StoredMediaAsset> StoreSanitizedSvgAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            Stream sanitizedSvgContent,
            CancellationToken cancellationToken = default) =>
            inner.StoreSanitizedSvgAsync(assetNamespace, entityId, sanitizedSvgContent, cancellationToken);

        public Task<StoredMediaAsset> StoreValidatedRasterAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            string extension,
            Stream validatedRasterContent,
            CancellationToken cancellationToken = default) =>
            FailRasterStore
                ? Task.FromException<StoredMediaAsset>(new IOException("Simulated raster storage failure."))
                : inner.StoreValidatedRasterAsync(
                    assetNamespace,
                    entityId,
                    extension,
                    validatedRasterContent,
                    cancellationToken);

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

        public Task<bool> DeleteOwnedAssetAsync(
            MediaAssetNamespace assetNamespace,
            int entityId,
            string? publicPath,
            CancellationToken cancellationToken = default) =>
            string.Equals(publicPath, DeleteFailurePath, StringComparison.Ordinal)
                ? Task.FromException<bool>(new IOException("Simulated old asset cleanup failure."))
                : inner.DeleteOwnedAssetAsync(assetNamespace, entityId, publicPath, cancellationToken);

        public Task<int> CleanupExpiredStagedAssetsAsync(CancellationToken cancellationToken = default) =>
            inner.CleanupExpiredStagedAssetsAsync(cancellationToken);
    }

    private sealed class StubUploadService(SiteSetting? result = null) : ISiteSettingUploadService
    {
        public int CallCount { get; private set; }

        public Task<SiteSetting> UploadAsync(
            string key,
            IFormFile file,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(result ?? throw new InvalidOperationException("No stub result configured."));
        }
    }

    private sealed class AllowPermissionService : IPermissionService
    {
        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    private sealed class DenyPermissionService : IPermissionService
    {
        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(false);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
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
                $"kooch-site-setting-upload-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
