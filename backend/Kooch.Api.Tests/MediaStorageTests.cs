using System.Net;
using System.Text;
using Kooch.Api.Services.MediaStorage;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class MediaStorageTests
{
    private const string SvgContent = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0h1v1H0z\"/></svg>";

    [Fact]
    public void ConfiguredRelativeRoot_ResolvesAgainstContentRootOutsideWebRoot()
    {
        using var temp = new TemporaryDirectory();
        var environment = CreateEnvironment(temp.Path);
        var storage = CreateStorage(environment, "../../storage/uploads");

        var expected = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../../storage/uploads"));
        Assert.Equal(expected, storage.RootPath);
        Assert.Equal("/uploads", storage.PublicBasePath);
        Assert.False(IsSameOrDescendant(storage.RootPath, environment.WebRootPath));
    }

    [Fact]
    public void Initialize_CreatesRootAndKnownNamespaceDirectories()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");

        storage.Initialize();

        Assert.True(Directory.Exists(storage.RootPath));
        Assert.True(Directory.Exists(Path.Combine(storage.RootPath, "amenity-categories")));
        Assert.True(Directory.Exists(Path.Combine(storage.RootPath, "amenities")));
        Assert.True(Directory.Exists(Path.Combine(storage.RootPath, ".staging", "amenity-categories")));
        Assert.True(Directory.Exists(Path.Combine(storage.RootPath, ".staging", "amenities")));
        Assert.Empty(Directory.GetFiles(storage.RootPath, ".kooch-write-probe-*"));
    }

    [Fact]
    public async Task StageSanitizedSvg_WritesOnlyPrivateOpaqueStagingAsset()
    {
        using var temp = new TemporaryDirectory();
        var now = new DateTimeOffset(2026, 8, 30, 8, 0, 0, TimeSpan.Zero);
        var timeProvider = new AdvanceableTimeProvider(now);
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root", timeProvider: timeProvider);

        var staged = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SvgContent);
        var stagedPath = GetStagedPath(storage, staged);

        Assert.True(Guid.TryParseExact(staged.UploadToken, "N", out _));
        Assert.DoesNotContain('/', staged.UploadToken);
        Assert.DoesNotContain('\\', staged.UploadToken);
        Assert.Equal(MediaAssetNamespace.Amenities, staged.AssetNamespace);
        Assert.Equal(now.AddHours(24), staged.ExpiresAtUtc);
        Assert.Equal(SvgContent, await File.ReadAllTextAsync(stagedPath));
        Assert.DoesNotContain(storage.PublicBasePath, stagedPath, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FinalizeStagedSvg_ConsumesTokenAndCreatesImmutableOwnedAsset()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        var staged = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.AmenityCategories, SvgContent);

        var stored = await storage.FinalizeStagedSvgAsync(
            MediaAssetNamespace.AmenityCategories,
            staged.UploadToken,
            11);

        Assert.Matches("^/uploads/amenity-categories/11/[0-9a-f]{32}\\.svg$", stored.PublicPath);
        Assert.False(File.Exists(GetStagedPath(storage, staged)));
        Assert.Equal(SvgContent, await File.ReadAllTextAsync(GetPhysicalPath(storage, stored)));
        var reused = await Assert.ThrowsAsync<MediaStagingException>(() =>
            storage.FinalizeStagedSvgAsync(
                MediaAssetNamespace.AmenityCategories,
                staged.UploadToken,
                11));
        Assert.Equal(MediaStagingFailure.TokenNotFound, reused.Failure);
    }

    [Theory]
    [InlineData(MediaAssetNamespace.AmenityCategories, MediaAssetNamespace.Amenities)]
    [InlineData(MediaAssetNamespace.Amenities, MediaAssetNamespace.AmenityCategories)]
    public async Task FinalizeStagedSvg_RejectsNamespaceMismatch(
        MediaAssetNamespace stagedNamespace,
        MediaAssetNamespace requestedNamespace)
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        var staged = await storage.StageSanitizedSvgAsync(stagedNamespace, SvgContent);

        var exception = await Assert.ThrowsAsync<MediaStagingException>(() =>
            storage.FinalizeStagedSvgAsync(requestedNamespace, staged.UploadToken, 17));

        Assert.Equal(MediaStagingFailure.NamespaceMismatch, exception.Failure);
        Assert.True(File.Exists(GetStagedPath(storage, staged)));
    }

    [Theory]
    [InlineData("not-a-token")]
    [InlineData("../amenities/0123456789abcdef0123456789abcdef")]
    [InlineData("01234567-89ab-cdef-0123-456789abcdef")]
    [InlineData("0123456789ABCDEF0123456789ABCDEF")]
    public async Task FinalizeStagedSvg_RejectsNonCanonicalOrTraversalTokens(string token)
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");

        var exception = await Assert.ThrowsAsync<MediaStagingException>(() =>
            storage.FinalizeStagedSvgAsync(MediaAssetNamespace.Amenities, token, 17));

        Assert.Equal(MediaStagingFailure.InvalidToken, exception.Failure);
    }

    [Fact]
    public async Task FinalizeStagedSvg_RejectsUnknownToken()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");

        var exception = await Assert.ThrowsAsync<MediaStagingException>(() =>
            storage.FinalizeStagedSvgAsync(
                MediaAssetNamespace.Amenities,
                Guid.NewGuid().ToString("N"),
                17));

        Assert.Equal(MediaStagingFailure.TokenNotFound, exception.Failure);
    }

    [Fact]
    public async Task ExpiredTokenCannotFinalizeAndCleanupNeverDeletesFinalAssets()
    {
        using var temp = new TemporaryDirectory();
        var timeProvider = new AdvanceableTimeProvider(
            new DateTimeOffset(2026, 8, 30, 8, 0, 0, TimeSpan.Zero));
        var storage = CreateStorage(
            CreateEnvironment(temp.Path),
            "../../media-root",
            timeProvider: timeProvider);
        var finalAsset = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);
        var staged = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SvgContent);
        timeProvider.Advance(TimeSpan.FromHours(25));

        var exception = await Assert.ThrowsAsync<MediaStagingException>(() =>
            storage.FinalizeStagedSvgAsync(MediaAssetNamespace.Amenities, staged.UploadToken, 17));
        var removed = await storage.CleanupExpiredStagedAssetsAsync();

        Assert.Equal(MediaStagingFailure.TokenExpired, exception.Failure);
        Assert.Equal(0, removed);
        Assert.False(File.Exists(GetStagedPath(storage, staged)));
        Assert.True(File.Exists(GetPhysicalPath(storage, finalAsset)));
    }

    [Fact]
    public async Task SameEntityFinalizationsAlwaysReceiveNewUrls()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        var firstStage = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SvgContent);
        var secondStage = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SvgContent);

        var first = await storage.FinalizeStagedSvgAsync(
            MediaAssetNamespace.Amenities, firstStage.UploadToken, 17);
        var second = await storage.FinalizeStagedSvgAsync(
            MediaAssetNamespace.Amenities, secondStage.UploadToken, 17);

        Assert.NotEqual(first.PublicPath, second.PublicPath);
        Assert.True(File.Exists(GetPhysicalPath(storage, first)));
        Assert.True(File.Exists(GetPhysicalPath(storage, second)));
    }

    [Fact]
    public async Task DeleteOwnedAsset_RequiresExactNamespaceEntityAndCanonicalPath()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        var asset = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);

        Assert.False(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.AmenityCategories, 17, asset.PublicPath));
        Assert.False(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.Amenities, 18, asset.PublicPath));
        Assert.False(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.Amenities, 17, "/svgs/amenities/wifi.svg"));
        Assert.False(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.Amenities, 17, "https://example.com/icon.svg"));
        Assert.False(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.Amenities, 17, "../../uploads/amenities/17/icon.svg"));
        Assert.True(File.Exists(GetPhysicalPath(storage, asset)));

        Assert.True(await storage.DeleteOwnedAssetAsync(MediaAssetNamespace.Amenities, 17, asset.PublicPath));
        Assert.False(File.Exists(GetPhysicalPath(storage, asset)));
    }

    [Fact]
    public async Task StoreSanitizedSvg_GeneratesCanonicalNamespaceAndPublicPaths()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");

        var category = await StoreSvgAsync(storage, MediaAssetNamespace.AmenityCategories, 11);
        var amenity = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);

        Assert.Matches($"^/uploads/amenity-categories/11/[0-9a-f]{{32}}\\.svg$", category.PublicPath);
        Assert.Matches($"^/uploads/amenities/17/[0-9a-f]{{32}}\\.svg$", amenity.PublicPath);
        Assert.Equal(SvgContent, await File.ReadAllTextAsync(GetPhysicalPath(storage, category)));
        Assert.Equal(SvgContent, await File.ReadAllTextAsync(GetPhysicalPath(storage, amenity)));
    }

    [Fact]
    public async Task ImmutableNames_PreventSameNameAndCrossEntityCollisions()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");

        var first = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);
        var sameEntityAndContent = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);
        var otherEntity = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 18);

        Assert.NotEqual(first.ImmutableId, sameEntityAndContent.ImmutableId);
        Assert.NotEqual(first.PublicPath, sameEntityAndContent.PublicPath);
        Assert.NotEqual(first.PublicPath, otherEntity.PublicPath);
        Assert.Contains("/amenities/17/", first.PublicPath);
        Assert.Contains("/amenities/18/", otherEntity.PublicPath);
        Assert.True(File.Exists(GetPhysicalPath(storage, first)));
        Assert.True(File.Exists(GetPhysicalPath(storage, sameEntityAndContent)));
        Assert.True(File.Exists(GetPhysicalPath(storage, otherEntity)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task StoreSanitizedSvg_RejectsInvalidEntityIdentifiers(int entityId)
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        await using var content = CreateSvgStream();

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            storage.StoreSanitizedSvgAsync(MediaAssetNamespace.Amenities, entityId, content));
    }

    [Fact]
    public async Task StoreSanitizedSvg_RejectsUnknownNamespace()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        await using var content = CreateSvgStream();

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            storage.StoreSanitizedSvgAsync((MediaAssetNamespace)999, 17, content));
    }

    [Theory]
    [InlineData("../uploads")]
    [InlineData("/uploads/../secret")]
    [InlineData("C:\\uploads")]
    [InlineData("https://media.example.com/uploads")]
    [InlineData("//media.example.com/uploads")]
    public void UnsafeOrAbsolutePublicPaths_AreRejected(string publicBasePath)
    {
        using var temp = new TemporaryDirectory();
        var environment = CreateEnvironment(temp.Path);

        Assert.Throws<InvalidOperationException>(() =>
            CreateStorage(environment, "../../media-root", publicBasePath));
    }

    [Fact]
    public void RootInsideWebRoot_IsRejected()
    {
        using var temp = new TemporaryDirectory();
        var environment = CreateEnvironment(temp.Path);

        Assert.Throws<InvalidOperationException>(() =>
            CreateStorage(environment, Path.Combine(environment.WebRootPath, "uploads")));
    }

    [Fact]
    public async Task GeneratedStoragePaths_CannotEscapeConfiguredRoot()
    {
        using var temp = new TemporaryDirectory();
        var storage = CreateStorage(CreateEnvironment(temp.Path), "../../media-root");
        var asset = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);

        var physicalPath = GetPhysicalPath(storage, asset);
        Assert.True(IsSameOrDescendant(physicalPath, storage.RootPath));
        Assert.DoesNotContain("..", Path.GetRelativePath(storage.RootPath, physicalPath));
        Assert.False(Path.IsPathRooted(asset.PublicPath.TrimStart('/')));
    }

    [Fact]
    public async Task UploadStaticSource_ServesSvgPropertyImagesAndLegacyStaticFiles()
    {
        using var temp = new TemporaryDirectory();
        var environment = CreateEnvironment(temp.Path);
        var storage = CreateStorage(environment, "../../media-root");
        var asset = await StoreSvgAsync(storage, MediaAssetNamespace.Amenities, 17);
        var staged = await storage.StageSanitizedSvgAsync(MediaAssetNamespace.Amenities, SvgContent);

        var legacyDirectory = Path.Combine(environment.WebRootPath, "svgs", "amenities");
        Directory.CreateDirectory(legacyDirectory);
        await File.WriteAllTextAsync(Path.Combine(legacyDirectory, "legacy.svg"), SvgContent);
        var propertyImageDirectory = Path.Combine(environment.WebRootPath, "uploads", "properties", "17");
        Directory.CreateDirectory(propertyImageDirectory);
        var propertyImagePath = Path.Combine(propertyImageDirectory, "property.webp");
        using (var propertyImage = new Image<Rgba32>(2, 2))
        {
            await propertyImage.SaveAsWebpAsync(propertyImagePath);
        }
        var propertyImageBytes = await File.ReadAllBytesAsync(propertyImagePath);
        await File.WriteAllTextAsync(Path.Combine(storage.RootPath, "not-public.html"), "<p>blocked</p>");

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = environment.ContentRootPath,
            EnvironmentName = "Testing"
        });
        builder.WebHost.UseWebRoot(environment.WebRootPath);
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        app.UseMediaStorageStaticFiles(storage);
        app.UseStaticFiles();
        app.Run(context =>
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        });

        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()!
            .Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };

        var uploadedResponse = await client.GetAsync(asset.PublicPath);
        Assert.Equal(HttpStatusCode.OK, uploadedResponse.StatusCode);
        Assert.Equal("image/svg+xml", uploadedResponse.Content.Headers.ContentType?.MediaType);
        Assert.Equal("public, max-age=31536000, immutable", uploadedResponse.Headers.CacheControl?.ToString());

        var legacyResponse = await client.GetAsync("/svgs/amenities/legacy.svg");
        Assert.Equal(HttpStatusCode.OK, legacyResponse.StatusCode);
        Assert.Equal("image/svg+xml", legacyResponse.Content.Headers.ContentType?.MediaType);

        var propertyImageResponse = await client.GetAsync("/uploads/properties/17/property.webp");
        Assert.Equal(HttpStatusCode.OK, propertyImageResponse.StatusCode);
        Assert.Equal("image/webp", propertyImageResponse.Content.Headers.ContentType?.MediaType);
        Assert.Equal(propertyImageBytes, await propertyImageResponse.Content.ReadAsByteArrayAsync());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/uploads/amenities/17/")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/uploads/not-public.html")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"/uploads/.staging/amenities/{staged.UploadToken}.svg")).StatusCode);
    }

    private static FileSystemMediaStorage CreateStorage(
        IWebHostEnvironment environment,
        string rootPath,
        string publicBasePath = "/uploads",
        TimeProvider? timeProvider = null) =>
        new(
            Options.Create(new MediaStorageOptions
            {
                RootPath = rootPath,
                PublicBasePath = publicBasePath,
                StagingLifetimeHours = 24
            }),
            environment,
            timeProvider);

    private static async Task<StoredMediaAsset> StoreSvgAsync(
        IMediaStorage storage,
        MediaAssetNamespace assetNamespace,
        int entityId)
    {
        await using var content = CreateSvgStream();
        return await storage.StoreSanitizedSvgAsync(assetNamespace, entityId, content);
    }

    private static MemoryStream CreateSvgStream() => new(Encoding.UTF8.GetBytes(SvgContent));

    private static string GetPhysicalPath(IMediaStorage storage, StoredMediaAsset asset)
    {
        var relative = asset.PublicPath[(storage.PublicBasePath.Length + 1)..]
            .Replace('/', Path.DirectorySeparatorChar);
        return Path.GetFullPath(Path.Combine(storage.RootPath, relative));
    }

    private static string GetStagedPath(IMediaStorage storage, StagedMediaAsset staged) =>
        Path.Combine(
            storage.RootPath,
            ".staging",
            staged.AssetNamespace == MediaAssetNamespace.Amenities ? "amenities" : "amenity-categories",
            $"{staged.UploadToken}.svg");

    private static IWebHostEnvironment CreateEnvironment(string tempRoot)
    {
        var contentRoot = Path.Combine(tempRoot, "repo", "backend", "Kooch.Api");
        var webRoot = Path.Combine(contentRoot, "wwwroot");
        Directory.CreateDirectory(webRoot);
        return new TestWebHostEnvironment
        {
            ApplicationName = "Kooch.Api.Tests",
            EnvironmentName = "Testing",
            ContentRootPath = contentRoot,
            ContentRootFileProvider = new PhysicalFileProvider(contentRoot),
            WebRootPath = webRoot,
            WebRootFileProvider = new PhysicalFileProvider(webRoot)
        };
    }

    private static bool IsSameOrDescendant(string candidate, string root)
    {
        var relative = Path.GetRelativePath(root, candidate);
        return relative == "." ||
               (!Path.IsPathRooted(relative) &&
                relative != ".." &&
                !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
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
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"kooch-media-storage-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            Directory.Delete(Path, recursive: true);
        }
    }

    private sealed class AdvanceableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;

        public void Advance(TimeSpan duration) => utcNow = utcNow.Add(duration);
    }
}
