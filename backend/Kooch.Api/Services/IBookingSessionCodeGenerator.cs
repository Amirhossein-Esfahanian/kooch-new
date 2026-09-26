namespace Kooch.Api.Services;

public interface IBookingSessionCodeGenerator
{
    Task<string> GenerateAsync(CancellationToken cancellationToken = default);
}
