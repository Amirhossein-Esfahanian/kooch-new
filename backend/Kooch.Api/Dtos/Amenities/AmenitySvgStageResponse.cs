using Kooch.Api.Services.MediaStorage;

namespace Kooch.Api.Dtos.Amenities;

public sealed record AmenitySvgStageResponse(
    string UploadToken,
    MediaAssetNamespace AssetNamespace,
    DateTimeOffset ExpiresAtUtc);
