using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PaymentInitiationServiceTests
{
    [Fact]
    public async Task ReadySession_CreatesPendingSessionPaymentAndExactAllocations()
    {
        var deadline = DateTime.UtcNow.AddHours(1);
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(deadline, 125),
            Reservation(deadline, 275));

        var result = await harness.Service.InitiateBookingSessionPaymentAsync(Request());

        Assert.False(result.IsReplay);
        Assert.Equal(PaymentStatus.Pending, result.Status);
        Assert.Equal(400, result.Amount);
        Assert.Equal("IRR", result.Currency);
        Assert.Equal("test-provider", result.Provider);
        Assert.Null(result.TransactionReference);
        Assert.Equal(deadline, result.PaymentDeadlineUtc);
        Assert.Equal(64, result.RequestHash.Length);
        Assert.Equal(2, result.Items.Count);
        Assert.Equal(result.Amount, result.Items.Sum(item => item.AllocatedAmount));

        var payment = await harness.Context.Payments.Include(item => item.Items).SingleAsync();
        Assert.Null(payment.ReservationId);
        Assert.Equal(harness.SessionId, payment.BookingSessionId);
        Assert.Equal("payment-key", payment.IdempotencyKey);
        Assert.Equal(result.RequestHash, payment.RequestHash);
        Assert.Equal(2, payment.Items.Count);
    }

    [Theory]
    [InlineData(ReservationStatus.PendingApproval, "pending approvals")]
    [InlineData(ReservationStatus.Rejected, "rejected reservation")]
    public async Task BlockingReservationStatus_RejectsInitiation(
        ReservationStatus status,
        string expectedMessage)
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100, status));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request()));

        Assert.Contains(expectedMessage, exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task ExpiredDeadline_RejectsInitiation()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddMinutes(-1), 100));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request()));

        Assert.Contains("expired", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InconsistentDeadlines_RejectInitiation()
    {
        var deadline = DateTime.UtcNow.AddHours(1);
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(deadline, 100),
            Reservation(deadline.AddMinutes(5), 100));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request()));

        Assert.Contains("inconsistent", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CurrencyMismatch_RejectsInitiation()
    {
        var deadline = DateTime.UtcNow.AddHours(1);
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(deadline, 100),
            Reservation(deadline, 100, currency: "USD"));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request()));

        Assert.Contains("currency", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SameKeyAndPayload_ReturnsExistingPayment()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        var first = await harness.Service.InitiateBookingSessionPaymentAsync(Request("  pay-42  "));

        var replay = await harness.Service.InitiateBookingSessionPaymentAsync(Request("pay-42"));

        Assert.True(replay.IsReplay);
        Assert.Equal(first.PaymentId, replay.PaymentId);
        Assert.Equal(first.RequestHash, replay.RequestHash);
        Assert.Single(await harness.Context.Payments.ToListAsync());
    }

    [Theory]
    [InlineData(PaymentStatus.Successful)]
    [InlineData(PaymentStatus.Failed)]
    public async Task RetryAfterPaymentStatusChanges_ReturnsTheExistingPayment(PaymentStatus status)
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        var first = await harness.Service.InitiateBookingSessionPaymentAsync(Request("stable-key"));
        var payment = await harness.Context.Payments.SingleAsync();
        payment.Status = status;
        await harness.Context.SaveChangesAsync();

        var replay = await harness.Service.InitiateBookingSessionPaymentAsync(Request("stable-key"));

        Assert.True(replay.IsReplay);
        Assert.Equal(first.PaymentId, replay.PaymentId);
        Assert.Equal(status, replay.Status);
        Assert.Single(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task SameKeyWithDifferentPayload_IsRejected()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        await harness.Service.InitiateBookingSessionPaymentAsync(Request("pay-43"));
        var changed = Request("pay-43");
        changed.Provider = "different-provider";

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(changed));

        Assert.Contains("different payment payload", exception.Message, StringComparison.Ordinal);
        Assert.Single(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task DuplicatePendingPayment_WithAnotherKey_IsRejected()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        var first = await harness.Service.InitiateBookingSessionPaymentAsync(Request("first-key"));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request("second-key")));

        Assert.Contains("active pending payment", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.NotEqual(0, first.PaymentId);
        Assert.Single(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task ConcurrentRequestsWithTheSameKey_ReturnTheSamePayment()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        await using var firstScope = harness.CreateServiceScope();
        await using var secondScope = harness.CreateServiceScope();

        var results = await Task.WhenAll(
            firstScope.Service.InitiateBookingSessionPaymentAsync(Request("concurrent-key")),
            secondScope.Service.InitiateBookingSessionPaymentAsync(Request("concurrent-key")));

        Assert.Equal(results[0].PaymentId, results[1].PaymentId);
        Assert.Single(results, result => !result.IsReplay);
        Assert.Single(results, result => result.IsReplay);
        await using var verification = harness.CreateVerificationContext();
        Assert.Single(await verification.Payments.ToListAsync());
    }

    [Fact]
    public async Task PaymentItemFailure_RollsBackTheWholePayment()
    {
        var interceptor = new RejectMultiplePaymentItemsInterceptor();
        var deadline = DateTime.UtcNow.AddHours(1);
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            interceptor,
            Reservation(deadline, 100),
            Reservation(deadline, 200));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => harness.Service.InitiateBookingSessionPaymentAsync(Request()));

        await using var verification = harness.CreateVerificationContext();
        Assert.Empty(await verification.Payments.ToListAsync());
        Assert.Empty(await verification.PaymentItems.ToListAsync());
    }

    [Fact]
    public async Task LegacyPayment_RemainsUnchanged()
    {
        await using var harness = await PaymentInitiationHarness.CreateAsync(
            Reservation(DateTime.UtcNow.AddHours(1), 100));
        var legacy = new Payment
        {
            ReservationId = 999,
            Amount = 50,
            Currency = "IRR",
            Provider = "legacy",
            TransactionReference = "legacy-reference",
            Status = PaymentStatus.Successful,
            PaidAtUtc = DateTime.UtcNow.AddDays(-1)
        };
        harness.Context.Payments.Add(legacy);
        await harness.Context.SaveChangesAsync();

        await harness.Service.InitiateBookingSessionPaymentAsync(Request());

        var persisted = await harness.Context.Payments.SingleAsync(payment => payment.Id == legacy.Id);
        Assert.Equal(999, persisted.ReservationId);
        Assert.Null(persisted.BookingSessionId);
        Assert.Equal("legacy-reference", persisted.TransactionReference);
        Assert.Equal(PaymentStatus.Successful, persisted.Status);
    }

    private static BookingSessionPaymentInitiationRequest Request(string key = "payment-key") =>
        new()
        {
            BookingSessionId = 1,
            Provider = " test-provider ",
            IdempotencyKey = key
        };

    private static ReservationSpec Reservation(
        DateTime deadline,
        decimal amount,
        ReservationStatus status = ReservationStatus.ApprovedAwaitingPayment,
        string currency = "IRR") =>
        new(status, deadline, amount, currency);

    private sealed record ReservationSpec(
        ReservationStatus Status,
        DateTime Deadline,
        decimal Amount,
        string Currency);

    private sealed class RejectMultiplePaymentItemsInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context?.ChangeTracker.Entries<PaymentItem>()
                    .Count(entry => entry.State == EntityState.Added) > 1)
            {
                throw new InvalidOperationException("The second payment item failed.");
            }

            return ValueTask.FromResult(result);
        }
    }

    private sealed class PaymentInitiationHarness : IAsyncDisposable
    {
        private readonly DbContextOptions<KoochDbContext> options;

        private PaymentInitiationHarness(
            DbContextOptions<KoochDbContext> options,
            KoochDbContext context)
        {
            this.options = options;
            Context = context;
            Service = new PaymentService(context, new EffectiveAvailabilityService(context));
        }

        public int SessionId => 1;
        public KoochDbContext Context { get; }
        public PaymentService Service { get; }

        public static Task<PaymentInitiationHarness> CreateAsync(
            params ReservationSpec[] reservations) =>
            CreateAsync(null, reservations);

        public static async Task<PaymentInitiationHarness> CreateAsync(
            SaveChangesInterceptor? interceptor,
            params ReservationSpec[] reservations)
        {
            var builder = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"payment-initiation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning));
            if (interceptor is not null)
            {
                builder.AddInterceptors(interceptor);
            }

            var options = builder.Options;
            var context = new KoochDbContext(options);
            context.BookingSessions.Add(new BookingSession
            {
                Id = 1,
                SessionCode = "KCH-S-PAYMENT",
                ClientId = 1,
                PropertyId = 1,
                Currency = "IRR"
            });
            for (var index = 0; index < reservations.Length; index++)
            {
                var item = reservations[index];
                context.Reservations.Add(new Reservation
                {
                    Id = index + 10,
                    BookingSessionId = 1,
                    ReservationNumber = $"KCH-R-{index + 1}",
                    ClientId = 1,
                    PropertyId = 1,
                    RoomTypeId = index + 1,
                    CheckInDate = new DateOnly(2036, 1, 1),
                    CheckOutDate = new DateOnly(2036, 1, 2),
                    AdultCount = 1,
                    TotalPrice = item.Amount,
                    FinalAmount = item.Amount,
                    Currency = item.Currency,
                    Status = item.Status,
                    Source = ReservationSource.Website,
                    PaymentExpiresAtUtc = item.Deadline
                });
            }

            await context.SaveChangesAsync();
            return new PaymentInitiationHarness(options, context);
        }

        public KoochDbContext CreateVerificationContext() => new(options);

        public PaymentServiceScope CreateServiceScope()
        {
            var context = new KoochDbContext(options);
            return new PaymentServiceScope(
                context,
                new PaymentService(context, new EffectiveAvailabilityService(context)));
        }

        public async ValueTask DisposeAsync() => await Context.DisposeAsync();
    }

    private sealed class PaymentServiceScope(
        KoochDbContext context,
        PaymentService service) : IAsyncDisposable
    {
        public PaymentService Service { get; } = service;

        public ValueTask DisposeAsync() => context.DisposeAsync();
    }
}
