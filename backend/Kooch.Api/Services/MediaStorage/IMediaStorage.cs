namespace Kooch.Api.Services.MediaStorage;

public interface IMediaStorage
{
    string RootPath { get; }
    string PublicBasePath { get; }

    void Initialize();

    // Callers must validate and sanitize SVG content before it crosses this boundary.
    Task<StoredMediaAsset> StoreSanitizedSvgAsync(
        MediaAssetNamespace assetNamespace,
        int entityId,
        Stream sanitizedSvgContent,
        CancellationToken cancellationToken = default);

    Task<StagedMediaAsset> StageSanitizedSvgAsync(
        MediaAssetNamespace assetNamespace,
        string sanitizedSvg,
        CancellationToken cancellationToken = default);

    Task<StoredMediaAsset> FinalizeStagedSvgAsync(
        MediaAssetNamespace assetNamespace,
        string uploadToken,
        int entityId,
        CancellationToken cancellationToken = default);

    Task<bool> DeleteOwnedAssetAsync(
        MediaAssetNamespace assetNamespace,
        int entityId,
        string? publicPath,
        CancellationToken cancellationToken = default);

    Task<int> CleanupExpiredStagedAssetsAsync(
        CancellationToken cancellationToken = default);
}
