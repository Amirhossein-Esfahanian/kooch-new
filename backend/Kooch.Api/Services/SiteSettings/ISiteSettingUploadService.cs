using Kooch.Api.Entities;

namespace Kooch.Api.Services.SiteSettings;

public interface ISiteSettingUploadService
{
    Task<SiteSetting> DeleteImageAsync(
        string key,
        CancellationToken cancellationToken = default);

    Task<SiteSetting> UploadAsync(
        string key,
        IFormFile file,
        CancellationToken cancellationToken = default);
}
