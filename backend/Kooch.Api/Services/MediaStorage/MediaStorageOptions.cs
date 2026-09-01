namespace Kooch.Api.Services.MediaStorage;

public sealed class MediaStorageOptions
{
    public const string SectionName = "MediaStorage";

    public string RootPath { get; set; } = string.Empty;
    public string PublicBasePath { get; set; } = "/uploads";
    public int StagingLifetimeHours { get; set; } = 24;
}
