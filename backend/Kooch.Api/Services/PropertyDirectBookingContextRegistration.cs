using Microsoft.AspNetCore.DataProtection;

namespace Kooch.Api.Services;

public static class PropertyDirectBookingContextRegistration
{
    public static IServiceCollection AddPropertyDirectBookingContexts(
        this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(PropertyDirectBookingContextOptions.SectionName);
        services.AddOptions<PropertyDirectBookingContextOptions>().Bind(section)
            .Validate(options => options.LifetimeMinutes is >= 1 and <= 60,
                "Property Direct context lifetime must be between 1 and 60 minutes.");

        var settings = section.Get<PropertyDirectBookingContextOptions>() ?? new();
        var protection = services.AddDataProtection();
        // Never choose a machine-specific path or silently rely on ephemeral keys for this feature.
        // The service refuses issuance/validation until an explicit persistent ring is configured.
        if (settings.HasPersistentKeyRing)
        {
            protection.SetApplicationName(settings.ApplicationName!)
                .PersistKeysToFileSystem(new DirectoryInfo(settings.KeyRingPath!));
            if (!string.IsNullOrWhiteSpace(settings.KeyEncryptionCertificateThumbprint))
            {
                protection.ProtectKeysWithCertificate(settings.KeyEncryptionCertificateThumbprint);
            }
        }

        services.AddScoped<IPropertyDirectBookingContextService, PropertyDirectBookingContextService>();
        return services;
    }
}
