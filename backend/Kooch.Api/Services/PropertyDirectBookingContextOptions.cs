namespace Kooch.Api.Services;

public sealed class PropertyDirectBookingContextOptions
{
    public const string SectionName = "PropertyDirectBookingContexts";
    public int LifetimeMinutes { get; set; } = 20;
    public string? KeyRingPath { get; set; }
    public string? ApplicationName { get; set; }
    public string? KeyEncryptionCertificateThumbprint { get; set; }

    internal bool HasPersistentKeyRing =>
        !string.IsNullOrWhiteSpace(KeyRingPath) && Path.IsPathFullyQualified(KeyRingPath) &&
        Directory.Exists(KeyRingPath) && !string.IsNullOrWhiteSpace(ApplicationName);
}
