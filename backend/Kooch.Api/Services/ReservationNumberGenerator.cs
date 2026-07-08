using System.Globalization;
using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationNumberGenerator(KoochDbContext dbContext) : IReservationNumberGenerator
{
    private const string Prefix = "KCH";
    private const int SequenceWidth = 6;

    public async Task<string> GenerateAsync(
        DateTime? nowUtc = null,
        CancellationToken cancellationToken = default)
    {
        var datePart = (nowUtc ?? DateTime.UtcNow).ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var prefix = $"{Prefix}-{datePart}-";

        var existingNumbers = await dbContext.Reservations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(reservation =>
                reservation.ReservationNumber != null &&
                reservation.ReservationNumber.StartsWith(prefix))
            .Select(reservation => reservation.ReservationNumber!)
            .ToListAsync(cancellationToken);

        var usedSequences = existingNumbers
            .Select(number => TryParseSequence(number, prefix))
            .Where(sequence => sequence.HasValue)
            .Select(sequence => sequence!.Value)
            .ToHashSet();

        var nextSequence = usedSequences.Count == 0 ? 1 : usedSequences.Max() + 1;
        while (true)
        {
            var candidate = $"{prefix}{nextSequence.ToString($"D{SequenceWidth}", CultureInfo.InvariantCulture)}";
            if (!usedSequences.Contains(nextSequence) &&
                !await dbContext.Reservations.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(reservation => reservation.ReservationNumber == candidate, cancellationToken))
            {
                return candidate;
            }

            nextSequence++;
        }
    }

    private static int? TryParseSequence(string reservationNumber, string prefix)
    {
        if (!reservationNumber.StartsWith(prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var sequencePart = reservationNumber[prefix.Length..];
        return int.TryParse(sequencePart, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence)
            ? sequence
            : null;
    }
}
