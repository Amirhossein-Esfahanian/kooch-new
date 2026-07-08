namespace Kooch.Api.Services;

public interface IReservationNumberGenerator
{
    Task<string> GenerateAsync(DateTime? nowUtc = null, CancellationToken cancellationToken = default);
}
