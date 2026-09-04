using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.MediaStorage;

public sealed class FileSystemMediaStorage : IMediaStorage
{
    private const string StagingDirectoryName = ".staging";
    private const int MaximumSanitizedSvgBytes = 256 * 1024;
    private readonly object initializationLock = new();
    private readonly SemaphoreSlim stagingLock = new(1, 1);
    private readonly TimeProvider timeProvider;
    private readonly ILogger<FileSystemMediaStorage> logger;
    private readonly TimeSpan stagingLifetime;
    private bool initialized;

    public FileSystemMediaStorage(
        IOptions<MediaStorageOptions> options,
        IWebHostEnvironment environment,
        TimeProvider? timeProvider = null,
        ILogger<FileSystemMediaStorage>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);

        RootPath = ResolveRootPath(
            options.Value.RootPath,
            environment.ContentRootPath,
            environment.WebRootPath);
        PublicBasePath = NormalizePublicBasePath(options.Value.PublicBasePath);
        if (options.Value.StagingLifetimeHours <= 0)
        {
            throw new InvalidOperationException("MediaStorage:StagingLifetimeHours must be positive.");
        }

        stagingLifetime = TimeSpan.FromHours(options.Value.StagingLifetimeHours);
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.logger = logger ?? NullLogger<FileSystemMediaStorage>.Instance;
    }

    public string RootPath { get; }
    public string PublicBasePath { get; }

    public void Initialize()
    {
        if (initialized)
        {
            return;
        }

        lock (initializationLock)
        {
            if (initialized)
            {
                return;
            }

            Directory.CreateDirectory(RootPath);
            foreach (var assetNamespace in Enum.GetValues<MediaAssetNamespace>())
            {
                Directory.CreateDirectory(GetNamespaceRoot(assetNamespace));
                Directory.CreateDirectory(GetStagingNamespaceRoot(assetNamespace));
            }

            VerifyWriteAccess();
            initialized = true;
        }
    }

    public async Task<StoredMediaAsset> StoreSanitizedSvgAsync(
        MediaAssetNamespace assetNamespace,
        int entityId,
        Stream sanitizedSvgContent,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sanitizedSvgContent);
        if (!sanitizedSvgContent.CanRead)
        {
            throw new ArgumentException("The sanitized SVG stream must be readable.", nameof(sanitizedSvgContent));
        }

        if (entityId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(entityId), "A positive entity ID is required.");
        }

        Initialize();

        var namespaceSegment = GetNamespaceSegment(assetNamespace);
        var entitySegment = entityId.ToString(CultureInfo.InvariantCulture);
        var entityDirectory = EnsureWithinRoot(Path.Combine(RootPath, namespaceSegment, entitySegment));
        Directory.CreateDirectory(entityDirectory);

        var immutableId = Guid.NewGuid();
        var fileName = $"{immutableId:N}.svg";
        var physicalPath = EnsureWithinRoot(Path.Combine(entityDirectory, fileName));

        try
        {
            await using var destination = new FileStream(
                physicalPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                useAsync: true);
            await sanitizedSvgContent.CopyToAsync(destination, cancellationToken);
        }
        catch
        {
            File.Delete(physicalPath);
            throw;
        }

        return new StoredMediaAsset(
            immutableId,
            $"{PublicBasePath}/{namespaceSegment}/{entitySegment}/{fileName}");
    }

    public async Task<StagedMediaAsset> StageSanitizedSvgAsync(
        MediaAssetNamespace assetNamespace,
        string sanitizedSvg,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sanitizedSvg))
        {
            throw new ArgumentException("Sanitized SVG content is required.", nameof(sanitizedSvg));
        }

        var content = Encoding.UTF8.GetBytes(sanitizedSvg);
        if (content.Length > MaximumSanitizedSvgBytes)
        {
            throw new ArgumentException("Sanitized SVG content exceeds the storage boundary.", nameof(sanitizedSvg));
        }

        Initialize();
        await stagingLock.WaitAsync(cancellationToken);
        try
        {
            await CleanupExpiredStagedAssetsCoreAsync(cancellationToken);
            var token = Guid.NewGuid().ToString("N");
            var stagedPath = GetStagedPath(assetNamespace, token);
            var stagedAtUtc = timeProvider.GetUtcNow();
            try
            {
                await using var destination = new FileStream(
                    stagedPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    bufferSize: 81920,
                    useAsync: true);
                await destination.WriteAsync(content, cancellationToken);
                await destination.FlushAsync(cancellationToken);
                File.SetLastWriteTimeUtc(stagedPath, stagedAtUtc.UtcDateTime);
            }
            catch (Exception exception)
            {
                File.Delete(stagedPath);
                logger.LogError(exception, "Sanitized SVG staging failed for namespace {AssetNamespace}.", assetNamespace);
                throw;
            }

            return new StagedMediaAsset(
                token,
                assetNamespace,
                stagedAtUtc.Add(stagingLifetime));
        }
        finally
        {
            stagingLock.Release();
        }
    }

    public async Task<StoredMediaAsset> FinalizeStagedSvgAsync(
        MediaAssetNamespace assetNamespace,
        string uploadToken,
        int entityId,
        CancellationToken cancellationToken = default)
    {
        if (entityId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(entityId), "A positive entity ID is required.");
        }

        string token;
        try
        {
            token = ValidateUploadToken(uploadToken);
        }
        catch (MediaStagingException)
        {
            logger.LogWarning("Invalid staged SVG token rejected for {AssetNamespace}.", assetNamespace);
            throw;
        }
        Initialize();
        await stagingLock.WaitAsync(cancellationToken);
        try
        {
            var stagedPath = GetStagedPath(assetNamespace, token);
            if (!File.Exists(stagedPath))
            {
                if (Enum.GetValues<MediaAssetNamespace>()
                    .Where(candidate => candidate != assetNamespace)
                    .Any(candidate => File.Exists(GetStagedPath(candidate, token))))
                {
                    logger.LogWarning("Staged SVG namespace mismatch for {AssetNamespace}.", assetNamespace);
                    throw new MediaStagingException(
                        MediaStagingFailure.NamespaceMismatch,
                        "The staged SVG does not belong to the expected asset namespace.");
                }

                logger.LogWarning("Unknown or already consumed staged SVG token for {AssetNamespace}.", assetNamespace);
                throw new MediaStagingException(
                    MediaStagingFailure.TokenNotFound,
                    "The staged SVG token is unknown or has already been consumed.");
            }

            if (IsExpired(stagedPath))
            {
                File.Delete(stagedPath);
                logger.LogWarning("Expired staged SVG token rejected for {AssetNamespace}.", assetNamespace);
                throw new MediaStagingException(
                    MediaStagingFailure.TokenExpired,
                    "The staged SVG token has expired.");
            }

            await CleanupExpiredStagedAssetsCoreAsync(cancellationToken, stagedPath);

            var namespaceSegment = GetNamespaceSegment(assetNamespace);
            var entitySegment = entityId.ToString(CultureInfo.InvariantCulture);
            var entityDirectory = EnsureWithinRoot(Path.Combine(RootPath, namespaceSegment, entitySegment));
            Directory.CreateDirectory(entityDirectory);
            var immutableId = Guid.NewGuid();
            var fileName = $"{immutableId:N}.svg";
            var finalPath = EnsureWithinRoot(Path.Combine(entityDirectory, fileName));

            try
            {
                File.Move(stagedPath, finalPath, overwrite: false);
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Staged SVG finalization failed for namespace {AssetNamespace} and entity {EntityId}.",
                    assetNamespace,
                    entityId);
                throw;
            }

            return new StoredMediaAsset(
                immutableId,
                $"{PublicBasePath}/{namespaceSegment}/{entitySegment}/{fileName}");
        }
        finally
        {
            stagingLock.Release();
        }
    }

    public Task<bool> DeleteOwnedAssetAsync(
        MediaAssetNamespace assetNamespace,
        int entityId,
        string? publicPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (entityId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(entityId), "A positive entity ID is required.");
        }

        if (!TryResolveOwnedAssetPath(assetNamespace, entityId, publicPath, out var physicalPath))
        {
            return Task.FromResult(false);
        }

        if (!File.Exists(physicalPath))
        {
            logger.LogWarning(
                "Owned media asset was missing during cleanup for namespace {AssetNamespace} and entity {EntityId}.",
                assetNamespace,
                entityId);
            return Task.FromResult(false);
        }

        File.Delete(physicalPath);
        return Task.FromResult(true);
    }

    public async Task<int> CleanupExpiredStagedAssetsAsync(
        CancellationToken cancellationToken = default)
    {
        Initialize();
        await stagingLock.WaitAsync(cancellationToken);
        try
        {
            return await CleanupExpiredStagedAssetsCoreAsync(cancellationToken);
        }
        finally
        {
            stagingLock.Release();
        }
    }

    internal static string GetNamespaceSegment(MediaAssetNamespace assetNamespace) => assetNamespace switch
    {
        MediaAssetNamespace.AmenityCategories => "amenity-categories",
        MediaAssetNamespace.Amenities => "amenities",
        MediaAssetNamespace.BedTypes => "bed-types",
        _ => throw new ArgumentOutOfRangeException(nameof(assetNamespace), "Unknown media asset namespace.")
    };

    private string GetNamespaceRoot(MediaAssetNamespace assetNamespace) =>
        EnsureWithinRoot(Path.Combine(RootPath, GetNamespaceSegment(assetNamespace)));

    private string GetStagingNamespaceRoot(MediaAssetNamespace assetNamespace) =>
        EnsureWithinRoot(Path.Combine(RootPath, StagingDirectoryName, GetNamespaceSegment(assetNamespace)));

    private string GetStagedPath(MediaAssetNamespace assetNamespace, string token) =>
        EnsureWithinRoot(Path.Combine(GetStagingNamespaceRoot(assetNamespace), $"{token}.svg"));

    private static string ValidateUploadToken(string uploadToken)
    {
        var token = uploadToken?.Trim() ?? string.Empty;
        if (!Guid.TryParseExact(token, "N", out var parsedToken) ||
            !parsedToken.ToString("N").Equals(token, StringComparison.Ordinal))
        {
            throw new MediaStagingException(
                MediaStagingFailure.InvalidToken,
                "The staged SVG token is invalid.");
        }

        return token;
    }

    private bool IsExpired(string stagedPath) =>
        new DateTimeOffset(File.GetLastWriteTimeUtc(stagedPath), TimeSpan.Zero).Add(stagingLifetime) <=
        timeProvider.GetUtcNow();

    private Task<int> CleanupExpiredStagedAssetsCoreAsync(
        CancellationToken cancellationToken,
        string? excludedPath = null)
    {
        var deletedCount = 0;
        foreach (var assetNamespace in Enum.GetValues<MediaAssetNamespace>())
        {
            foreach (var stagedPath in Directory.EnumerateFiles(
                         GetStagingNamespaceRoot(assetNamespace),
                         "*.svg",
                         SearchOption.TopDirectoryOnly))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (string.Equals(stagedPath, excludedPath, StringComparison.OrdinalIgnoreCase) ||
                    !IsExpired(stagedPath))
                {
                    continue;
                }

                try
                {
                    File.Delete(stagedPath);
                    deletedCount++;
                }
                catch (Exception exception)
                {
                    logger.LogWarning(
                        exception,
                        "Expired staged SVG cleanup failed for namespace {AssetNamespace}.",
                        assetNamespace);
                }
            }
        }

        return Task.FromResult(deletedCount);
    }

    private bool TryResolveOwnedAssetPath(
        MediaAssetNamespace assetNamespace,
        int entityId,
        string? publicPath,
        out string physicalPath)
    {
        physicalPath = string.Empty;
        var expectedPrefix = $"{PublicBasePath}/";
        if (string.IsNullOrWhiteSpace(publicPath) ||
            !publicPath.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
            publicPath.Contains('\\') ||
            publicPath.Contains('?') ||
            publicPath.Contains('#'))
        {
            return false;
        }

        var segments = publicPath[expectedPrefix.Length..].Split('/', StringSplitOptions.None);
        var expectedNamespace = GetNamespaceSegment(assetNamespace);
        var expectedEntity = entityId.ToString(CultureInfo.InvariantCulture);
        if (segments.Length != 3 ||
            !segments[0].Equals(expectedNamespace, StringComparison.Ordinal) ||
            !segments[1].Equals(expectedEntity, StringComparison.Ordinal) ||
            !segments[2].EndsWith(".svg", StringComparison.Ordinal) ||
            !Guid.TryParseExact(Path.GetFileNameWithoutExtension(segments[2]), "N", out _))
        {
            return false;
        }

        physicalPath = EnsureWithinRoot(Path.Combine(RootPath, expectedNamespace, expectedEntity, segments[2]));
        return true;
    }

    private string EnsureWithinRoot(string candidatePath)
    {
        var fullCandidate = Path.GetFullPath(candidatePath);
        var relative = Path.GetRelativePath(RootPath, fullCandidate);
        if (relative == ".." ||
            relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
            Path.IsPathRooted(relative))
        {
            throw new InvalidOperationException("Media storage path escaped the configured root.");
        }

        return fullCandidate;
    }

    private void VerifyWriteAccess()
    {
        var probePath = EnsureWithinRoot(Path.Combine(RootPath, $".kooch-write-probe-{Guid.NewGuid():N}.tmp"));
        try
        {
            using var probe = new FileStream(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        }
        finally
        {
            File.Delete(probePath);
        }
    }

    private static string ResolveRootPath(
        string configuredRootPath,
        string contentRootPath,
        string? webRootPath)
    {
        if (string.IsNullOrWhiteSpace(configuredRootPath))
        {
            throw new InvalidOperationException("MediaStorage:RootPath must be configured.");
        }

        var fullRoot = Path.GetFullPath(
            Path.IsPathRooted(configuredRootPath)
                ? configuredRootPath
                : Path.Combine(contentRootPath, configuredRootPath));
        var filesystemRoot = Path.GetPathRoot(fullRoot);
        if (string.Equals(fullRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                filesystemRoot?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("MediaStorage:RootPath cannot be a filesystem root.");
        }

        var effectiveWebRoot = Path.GetFullPath(
            string.IsNullOrWhiteSpace(webRootPath)
                ? Path.Combine(contentRootPath, "wwwroot")
                : webRootPath);
        if (IsSameOrDescendant(fullRoot, effectiveWebRoot))
        {
            throw new InvalidOperationException("MediaStorage:RootPath must be outside the application web root.");
        }

        return fullRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string NormalizePublicBasePath(string configuredPath)
    {
        var value = configuredPath?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith('/') ||
            value.StartsWith("//", StringComparison.Ordinal) ||
            value.Contains('\\') ||
            value.Contains('?') ||
            value.Contains('#') ||
            Uri.TryCreate(value, UriKind.Absolute, out _))
        {
            throw new InvalidOperationException("MediaStorage:PublicBasePath must be an origin-relative request path.");
        }

        var segments = value.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(segment => segment is "." or ".."))
        {
            throw new InvalidOperationException("MediaStorage:PublicBasePath contains an unsafe path segment.");
        }

        return $"/{string.Join('/', segments)}";
    }

    private static bool IsSameOrDescendant(string candidate, string root)
    {
        var relative = Path.GetRelativePath(root, candidate);
        return relative == "." ||
               (!Path.IsPathRooted(relative) &&
                relative != ".." &&
                !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }
}
