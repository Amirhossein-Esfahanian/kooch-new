namespace Kooch.Api.Services;

public interface IReservationNumberGenerator
{
    Task<string> GenerateAsync(DateTime? nowUtc = null, CancellationToken cancellationToken = default);

    async Task<IReadOnlyList<string>> GenerateBatchAsync(
        int count,
        DateTime? nowUtc = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(count);

        var numbers = new string[count];
        for (var index = 0; index < count; index++)
        {
            numbers[index] = await GenerateAsync(nowUtc, cancellationToken);
        }

        return numbers;
    }
}
