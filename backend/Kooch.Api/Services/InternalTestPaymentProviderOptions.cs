namespace Kooch.Api.Services;

public sealed class InternalTestPaymentProviderOptions
{
    public const string SectionName = "PaymentProviders:InternalTest";

    public bool Enabled { get; set; }
    public string? SigningSecret { get; set; }

    internal static bool IsEnabled(string environmentName, bool enabled) =>
        enabled &&
        (string.Equals(environmentName, "Development", StringComparison.OrdinalIgnoreCase) ||
         string.Equals(environmentName, "Testing", StringComparison.OrdinalIgnoreCase));
}
