namespace Kooch.Api.Services.MediaStorage;

public sealed record StagedMediaAsset(
    string UploadToken,
    MediaAssetNamespace AssetNamespace,
    DateTimeOffset ExpiresAtUtc);
