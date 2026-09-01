namespace Kooch.Api.Services.Svg;

public interface ISvgSanitizer
{
    Task<string> SanitizeAsync(
        Stream input,
        CancellationToken cancellationToken = default);
}
