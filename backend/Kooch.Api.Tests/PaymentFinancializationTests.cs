using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PaymentFinancializationTests
{
    [Fact]
    public async Task DirectSuccessfulPayment_ConfirmsAndCreatesSnapshotAndPositivePayable()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync();

        var result = await harness.PaymentService.ConfirmSuccessfulPaymentAsync(
            10,
            new PaymentConfirmationRequest
            {
                Amount = 100m,
                Currency = "IRR",
                TransactionReference = "direct-transaction"
            });

        Assert.Equal(ReservationStatus.Confirmed, result.ReservationStatus);
        var payment = await harness.Context.Payments.SingleAsync();
        var snapshot = await harness.Context.ReservationFinancialSnapshots.SingleAsync();
        var entry = await harness.Context.FinancialEntries.SingleAsync();
        Assert.Equal(payment.Amount, snapshot.GrossAmount);
        Assert.Equal(100m, snapshot.CommissionBase);
        Assert.Equal(10m, snapshot.CommissionAmount);
        Assert.Equal(90m, snapshot.PropertyPayableAmount);
        Assert.Equal(FinancialEntryType.PropertyPayable, entry.EntryType);
        Assert.Equal(90m, entry.Amount);
        Assert.True(entry.Amount > 0);
        Assert.Equal($"payment:{payment.Id}:reservation:10", entry.CorrelationKey);
        Assert.Empty(await harness.Context.FinancialEntries
            .Where(candidate => candidate.EntryType == FinancialEntryType.Commission)
            .ToListAsync());
        Assert.Equal(snapshot.GrossAmount, snapshot.CommissionAmount + snapshot.PropertyPayableAmount);
    }

    [Fact]
    public async Task DirectPayment_WhenCapacityIsLost_DoesNotRecognizeNormalEconomics()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync(hasCapacity: false);

        var result = await harness.PaymentService.ConfirmSuccessfulPaymentAsync(
            10,
            new PaymentConfirmationRequest
            {
                Amount = 100m,
                Currency = "IRR",
                TransactionReference = "capacity-lost"
            });

        Assert.Equal(ReservationStatus.CapacityLost, result.ReservationStatus);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
    }

    [Fact]
    public async Task DirectPayment_WhenCommissionConfigurationFails_DoesNotConfirmOrCreateFinancialRows()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync(includeGlobalSetting: false);

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.PaymentService.ConfirmSuccessfulPaymentAsync(
                10,
                new PaymentConfirmationRequest
                {
                    Amount = 100m,
                    Currency = "IRR",
                    TransactionReference = "missing-commission"
                }));

        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.FindAsync(10))!.Status);
        Assert.Empty(await harness.Context.ReservationFinancialSnapshots.ToListAsync());
        Assert.Empty(await harness.Context.FinancialEntries.ToListAsync());
    }

    [Fact]
    public async Task SessionPayment_UsesEachAllocationAndResolvesMixedCommissionTypesIndependently()
    {
        await using var harness = await FinancializationHarness.CreateSessionAsync();
        var payment = await harness.Context.Payments.SingleAsync();
        var handler = harness.DomainHandler;

        await handler.ApplyAsync(payment);
        await harness.Context.SaveChangesAsync();

        var snapshots = await harness.Context.ReservationFinancialSnapshots
            .OrderBy(snapshot => snapshot.ReservationId)
            .ToListAsync();
        Assert.Equal(2, snapshots.Count);
        Assert.Equal([100m, 200m], snapshots.Select(snapshot => snapshot.GrossAmount));
        Assert.DoesNotContain(snapshots, snapshot => snapshot.GrossAmount == payment.Amount);
        Assert.Equal(
            [CommissionType.Direct, CommissionType.PropertyReferralLink],
            snapshots.Select(snapshot => snapshot.CommissionType));
        Assert.Equal([10m, 40m], snapshots.Select(snapshot => snapshot.CommissionAmount));
        Assert.All(snapshots, snapshot =>
            Assert.Equal(snapshot.GrossAmount, snapshot.CommissionAmount + snapshot.PropertyPayableAmount));

        var entries = await harness.Context.FinancialEntries.ToListAsync();
        Assert.Equal(2, entries.Count);
        Assert.All(entries, entry => Assert.Equal(FinancialEntryType.PropertyPayable, entry.EntryType));
        Assert.Equal([90m, 160m], entries.OrderBy(entry => entry.ReservationId).Select(entry => entry.Amount));
    }

    [Fact]
    public async Task PropertyOverride_IsPersistedWithExactPolicyAndCalculationMetadata()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync();
        harness.Context.PropertyCommissionRates.Add(new PropertyCommissionRate
        {
            Id = 41,
            PropertyId = 1,
            CommissionType = CommissionType.Direct,
            Rate = 12.5m,
            IsEnabled = true
        });
        var reservation = await harness.Context.Reservations.SingleAsync();
        reservation.TotalPrice = 1m;
        reservation.FinalAmount = 1m;
        await harness.Context.SaveChangesAsync();

        await harness.PaymentService.ConfirmSuccessfulPaymentAsync(
            10,
            new PaymentConfirmationRequest
            {
                Amount = 1m,
                Currency = "IRR",
                TransactionReference = "override"
            });

        var snapshot = await harness.Context.ReservationFinancialSnapshots.SingleAsync();
        Assert.Equal(CommissionType.Direct, snapshot.CommissionType);
        Assert.Equal(CommissionRateSource.PropertyOverride, snapshot.CommissionRateSource);
        Assert.Equal(12.5m, snapshot.CommissionRate);
        Assert.Equal(1m, snapshot.CommissionBase);
        Assert.Equal(0.13m, snapshot.CommissionAmount);
        Assert.Equal(0.87m, snapshot.PropertyPayableAmount);
        Assert.Equal("PropertyCommissionRate:41", snapshot.CommissionPolicySource);
        Assert.False(string.IsNullOrWhiteSpace(snapshot.CommissionPolicyVersion));
    }

    [Fact]
    public async Task GlobalFallback_IsPersistedWithExactPolicyMetadata()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync();

        await harness.PaymentService.ConfirmSuccessfulPaymentAsync(
            10,
            new PaymentConfirmationRequest
            {
                Amount = 100m,
                Currency = "IRR",
                TransactionReference = "global"
            });

        var snapshot = await harness.Context.ReservationFinancialSnapshots.SingleAsync();
        Assert.Equal(CommissionRateSource.Global, snapshot.CommissionRateSource);
        Assert.Equal(10m, snapshot.CommissionRate);
        Assert.Equal(CommissionPolicyResolver.DirectSettingKey, snapshot.CommissionPolicySource);
        Assert.False(string.IsNullOrWhiteSpace(snapshot.CommissionPolicyVersion));
    }

    [Fact]
    public async Task FinancialApplicationRetry_DoesNotDuplicateSnapshotOrPayableEntry()
    {
        await using var harness = await FinancializationHarness.CreateDirectAsync();
        var reservation = await harness.Context.Reservations.SingleAsync();
        var payment = new Payment
        {
            Id = 100,
            ReservationId = reservation.Id,
            Amount = 100m,
            Currency = "IRR",
            Status = PaymentStatus.Successful
        };
        harness.Context.Payments.Add(payment);
        await harness.Context.SaveChangesAsync();
        var financialization = new PaymentFinancializationService(
            harness.Context,
            new CommissionPolicyResolver(harness.Context));

        await financialization.ApplyAsync(reservation, payment, null, 100m, DateTime.UtcNow);
        await harness.Context.SaveChangesAsync();
        await financialization.ApplyAsync(reservation, payment, null, 100m, DateTime.UtcNow);
        await harness.Context.SaveChangesAsync();

        Assert.Equal(1, await harness.Context.ReservationFinancialSnapshots.CountAsync());
        Assert.Equal(1, await harness.Context.FinancialEntries.CountAsync());
    }

    private sealed class FinancializationHarness : IAsyncDisposable
    {
        private FinancializationHarness(
            KoochDbContext context,
            StubAvailabilityService availability)
        {
            Context = context;
            PaymentService = new PaymentService(context, availability);
            DomainHandler = new PaymentDomainApplicationHandler(context, availability);
        }

        public KoochDbContext Context { get; }
        public PaymentService PaymentService { get; }
        public PaymentDomainApplicationHandler DomainHandler { get; }

        public static async Task<FinancializationHarness> CreateDirectAsync(
            bool hasCapacity = true,
            bool includeGlobalSetting = true)
        {
            var harness = Create(hasCapacity);
            if (includeGlobalSetting)
            {
                AddGlobalSetting(harness.Context, CommissionPolicyResolver.DirectSettingKey, "10");
            }

            harness.Context.RoomTypes.Add(RoomType(10));
            harness.Context.Reservations.Add(Reservation(
                id: 10,
                roomTypeId: 10,
                amount: 100m,
                commissionType: CommissionType.Direct,
                bookingSessionId: null));
            await harness.Context.SaveChangesAsync();
            return harness;
        }

        public static async Task<FinancializationHarness> CreateSessionAsync()
        {
            var harness = Create(hasCapacity: true);
            AddGlobalSetting(harness.Context, CommissionPolicyResolver.DirectSettingKey, "10");
            AddGlobalSetting(harness.Context, CommissionPolicyResolver.PropertyReferralLinkSettingKey, "20");
            harness.Context.BookingSessions.Add(new BookingSession
            {
                Id = 1,
                SessionCode = "A2-2",
                ClientId = 1,
                PropertyId = 1,
                Currency = "IRR"
            });
            harness.Context.RoomTypes.AddRange(RoomType(10), RoomType(11));
            harness.Context.Reservations.AddRange(
                Reservation(10, 10, 100m, CommissionType.Direct, 1),
                Reservation(11, 11, 200m, CommissionType.PropertyReferralLink, 1));
            harness.Context.Payments.Add(new Payment
            {
                Id = 100,
                BookingSessionId = 1,
                Amount = 300m,
                Currency = "IRR",
                Status = PaymentStatus.Pending,
                Items =
                [
                    new PaymentItem
                    {
                        Id = 1000,
                        ReservationId = 10,
                        AllocatedAmount = 100m,
                        Currency = "IRR"
                    },
                    new PaymentItem
                    {
                        Id = 1001,
                        ReservationId = 11,
                        AllocatedAmount = 200m,
                        Currency = "IRR"
                    }
                ]
            });
            await harness.Context.SaveChangesAsync();
            return harness;
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();

        private static FinancializationHarness Create(bool hasCapacity)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"payment-financialization-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new FinancializationHarness(
                new KoochDbContext(options),
                new StubAvailabilityService(hasCapacity));
        }

        private static void AddGlobalSetting(KoochDbContext context, string key, string value) =>
            context.SiteSettings.Add(new SiteSetting
            {
                Key = key,
                Value = value,
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = key,
                IsActive = true
            });

        private static RoomType RoomType(int id) => new()
        {
            Id = id,
            PropertyId = 1,
            Name = $"Room type {id}",
            Slug = $"room-type-{id}",
            TotalInventory = 1,
            InventoryMode = InventoryMode.TypeBasedInventory
        };

        private static Reservation Reservation(
            int id,
            int roomTypeId,
            decimal amount,
            CommissionType commissionType,
            int? bookingSessionId) => new()
        {
            Id = id,
            BookingSessionId = bookingSessionId,
            ReservationNumber = $"KCH-A22-{id}",
            ClientId = 1,
            PropertyId = 1,
            RoomTypeId = roomTypeId,
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            AdultCount = 1,
            TotalPrice = amount,
            FinalAmount = amount,
            Currency = "IRR",
            CommissionType = commissionType,
            Status = ReservationStatus.ApprovedAwaitingPayment,
            Source = ReservationSource.Website,
            PaymentExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        };
    }

    private sealed class StubAvailabilityService(bool hasCapacity) : IEffectiveAvailabilityService
    {
        public Task<IReadOnlyDictionary<int, EffectiveRoomTypeAvailability>> GetRangeAsync(
            IReadOnlyCollection<int> roomTypeIds,
            DateOnly checkInDate,
            DateOnly checkOutDate,
            int? excludedReservationId = null,
            CancellationToken cancellationToken = default)
        {
            IReadOnlyDictionary<int, EffectiveRoomTypeAvailability> result = roomTypeIds.ToDictionary(
                roomTypeId => roomTypeId,
                roomTypeId => new EffectiveRoomTypeAvailability
                {
                    RoomTypeId = roomTypeId,
                    Nights = Enumerable.Range(0, checkOutDate.DayNumber - checkInDate.DayNumber)
                        .ToDictionary(
                            offset => checkInDate.AddDays(offset),
                            offset => new EffectiveAvailabilityNight
                            {
                                Date = checkInDate.AddDays(offset),
                                ConfiguredCapacity = 1,
                                ClaimedCapacity = hasCapacity ? 0 : 1,
                                RemainingCapacity = hasCapacity ? 1 : 0,
                                ConfiguredStatus = AvailabilityStatus.Available,
                                EffectiveStatus = hasCapacity
                                    ? AvailabilityStatus.Available
                                    : AvailabilityStatus.Unavailable,
                                IsClosed = false
                            })
                });
            return Task.FromResult(result);
        }
    }
}
