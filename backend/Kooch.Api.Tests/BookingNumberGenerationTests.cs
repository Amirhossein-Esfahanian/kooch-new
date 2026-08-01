using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingNumberGenerationTests
{
    [Fact]
    public async Task ReservationNumber_SingleGenerationPreservesExistingBehavior()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        var generator = new ReservationNumberGenerator(context);
        var nowUtc = new DateTime(2042, 7, 8, 9, 10, 11, DateTimeKind.Utc);

        var number = await generator.GenerateAsync(nowUtc);

        Assert.Equal("KCH-20420708-000001", number);
    }

    [Fact]
    public async Task ReservationNumbers_PreserveTheExistingFormatAndAdvancePastPersistedNumbers()
    {
        var options = CreateInMemoryOptions();
        var nowUtc = new DateTime(2040, 2, 3, 4, 5, 6, DateTimeKind.Utc);

        await using (var setupContext = new KoochDbContext(options))
        {
            setupContext.Reservations.AddRange(
                new Reservation { ReservationNumber = "KCH-20400203-000001" },
                new Reservation { ReservationNumber = "KCH-20400203-000004", IsDeleted = true });
            await setupContext.SaveChangesAsync();
        }

        await using var context = new KoochDbContext(options);
        var generator = new ReservationNumberGenerator(context);

        var numbers = await generator.GenerateBatchAsync(3, nowUtc);

        Assert.Equal(
            [
                "KCH-20400203-000005",
                "KCH-20400203-000006",
                "KCH-20400203-000007"
            ],
            numbers);
    }

    [Fact]
    public async Task ReservationNumbers_ConcurrentBatchAllocationProducesIndependentUniqueNumbers()
    {
        var options = CreateInMemoryOptions();
        var nowUtc = new DateTime(2041, 6, 7, 8, 9, 10, DateTimeKind.Utc);

        var allocations = await Task.WhenAll(
            Enumerable.Range(0, 32).Select(async _ =>
            {
                await using var context = new KoochDbContext(options);
                var generator = new ReservationNumberGenerator(context);
                return await generator.GenerateBatchAsync(4, nowUtc);
            }));

        var numbers = allocations.SelectMany(batch => batch).ToArray();
        Assert.Equal(128, numbers.Length);
        Assert.Equal(numbers.Length, numbers.Distinct(StringComparer.Ordinal).Count());
        Assert.All(numbers, number => Assert.Matches("^KCH-20410607-[0-9]{6}$", number));
    }

    [Fact]
    public async Task ReservationNumberBatch_RejectsAnInvalidCount()
    {
        await using var context = new KoochDbContext(CreateInMemoryOptions());
        var generator = new ReservationNumberGenerator(context);

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => generator.GenerateBatchAsync(0));
    }

    [Fact]
    public void SessionCodes_ConcurrentGenerationProducesUniqueFixedLengthCodes()
    {
        var generator = new BookingSessionCodeGenerator();
        var codes = new string[2_000];

        Parallel.For(0, codes.Length, index => codes[index] = generator.Generate());

        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.All(codes, code =>
        {
            Assert.Equal(32, code.Length);
            Assert.Matches("^KCH-S-[0-9A-F]{26}$", code);
        });
    }

    private static DbContextOptions<KoochDbContext> CreateInMemoryOptions() =>
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"booking-number-generation-{Guid.NewGuid():N}")
            .Options;
}
