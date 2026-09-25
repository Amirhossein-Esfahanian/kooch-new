namespace Kooch.Api.Services;

public interface IVoucherNumberGenerator
{
    Task<string> GenerateAsync(CancellationToken cancellationToken = default);
}
