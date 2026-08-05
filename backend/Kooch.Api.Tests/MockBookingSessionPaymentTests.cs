using System.Text.Json;
using System.Threading.RateLimiting;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Endpoints;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class MockBookingSessionPaymentTests
{
    [Fact]
    public async Task AccountInitiation_RequiresOwnershipAndIsIdempotent()
    {
        await using var harness = await Harness.CreateAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.AccountService.InitiateAsync(2, Harness.SessionCode, "pay-key"));
        var first = await harness.AccountService.InitiateAsync(1, Harness.SessionCode, "pay-key");
        var replay = await harness.AccountService.InitiateAsync(1, Harness.SessionCode, "pay-key");

        Assert.Equal(first.PaymentId, replay.PaymentId);
        Assert.True(replay.IsReplay);
        Assert.Equal(PaymentStatus.Pending, first.Status);
        Assert.Equal($"/booking/sessions/{Harness.SessionCode}/mock-payment", first.CheckoutDestination);
        Assert.DoesNotContain(Harness.SigningSecret, JsonSerializer.Serialize(first));
        Assert.Single(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task AccountInitiation_RejectsSessionThatIsNotPaymentReady()
    {
        await using var harness = await Harness.CreateAsync(ReservationStatus.PendingApproval);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.AccountService.InitiateAsync(1, Harness.SessionCode, "pay-key"));

        Assert.Contains("pending approvals", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.Payments.ToListAsync());
    }

    [Fact]
    public async Task MockSuccess_ConfirmsEveryChildAndDuplicateIsIdempotent()
    {
        await using var harness = await Harness.CreateAsync();
        await harness.AccountService.InitiateAsync(1, Harness.SessionCode, "pay-key");

        var first = await harness.MockService.SimulateAsync(1, Harness.SessionCode, true);
        var duplicate = await harness.MockService.SimulateAsync(1, Harness.SessionCode, true);

        Assert.Equal("applied", first.State);
        Assert.False(first.IsDuplicate);
        Assert.True(duplicate.IsDuplicate);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.Confirmed, reservation.Status));
        Assert.Equal(PaymentStatus.Successful, (await harness.Context.Payments.SingleAsync()).Status);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task MockFailure_DoesNotChangeAnyChildReservation()
    {
        await using var harness = await Harness.CreateAsync();
        await harness.AccountService.InitiateAsync(1, Harness.SessionCode, "pay-key");

        var result = await harness.MockService.SimulateAsync(1, Harness.SessionCode, false);

        Assert.Equal("failed", result.State);
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
        Assert.Equal(PaymentStatus.Failed, (await harness.Context.Payments.SingleAsync()).Status);
        Assert.Empty(await harness.Context.AuditLogs.ToListAsync());
        Assert.Empty(await harness.Context.NotificationLogs.ToListAsync());
    }

    [Theory]
    [InlineData("Development", true, true)]
    [InlineData("Testing", true, true)]
    [InlineData("Production", true, false)]
    [InlineData("Development", false, false)]
    public void InternalProviderRegistration_IsEnvironmentAndFlagGated(
        string environment,
        bool flag,
        bool expected)
    {
        Assert.Equal(expected, InternalTestPaymentProviderOptions.IsEnabled(environment, flag));
    }

    [Fact]
    public void DisabledMockCheckout_DoesNotRegisterAnyEndpoint()
    {
        var services = new ServiceCollection().AddRouting().BuildServiceProvider();
        var endpoints = new TestEndpointRouteBuilder(services);

        endpoints.MapMockPaymentCheckout(enabled: false);

        Assert.Empty(endpoints.DataSources.SelectMany(source => source.Endpoints));
    }

    private sealed class TestEndpointRouteBuilder(IServiceProvider serviceProvider)
        : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = serviceProvider;
        public ICollection<EndpointDataSource> DataSources { get; } = [];
        public IApplicationBuilder CreateApplicationBuilder() =>
            new ApplicationBuilder(ServiceProvider);
    }

    [Fact]
    public async Task MockRateLimit_IsPartitionedByUserAndSession()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(
            MockPaymentCheckoutRateLimitPolicy.CreatePartition);
        var context = RateLimitContext("1", "SESSION-A");
        var leases = new List<RateLimitLease>();
        for (var attempt = 0; attempt < MockPaymentCheckoutRateLimitPolicy.PermitLimit; attempt++)
        {
            var lease = await limiter.AcquireAsync(context);
            leases.Add(lease);
            Assert.True(lease.IsAcquired);
        }

        using var rejected = await limiter.AcquireAsync(context);
        using var otherSession = await limiter.AcquireAsync(RateLimitContext("1", "SESSION-B"));
        using var otherUser = await limiter.AcquireAsync(RateLimitContext("2", "SESSION-A"));
        Assert.False(rejected.IsAcquired);
        Assert.True(otherSession.IsAcquired);
        Assert.True(otherUser.IsAcquired);
        leases.ForEach(lease => lease.Dispose());
    }

    private static DefaultHttpContext RateLimitContext(string userId, string sessionCode)
    {
        var context = new DefaultHttpContext();
        context.User = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity(
                [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, userId)],
                "test"));
        context.Request.RouteValues["sessionCode"] = sessionCode;
        return context;
    }

    private sealed class Harness : IAsyncDisposable
    {
        internal const string SessionCode = "KCH-S-MOCK";
        internal const string SigningSecret = "test-only-server-signing-secret";

        private Harness(
            KoochDbContext context,
            AccountBookingSessionPaymentService accountService,
            MockPaymentCheckoutService mockService)
        {
            Context = context;
            AccountService = accountService;
            MockService = mockService;
        }

        public KoochDbContext Context { get; }
        public AccountBookingSessionPaymentService AccountService { get; }
        public MockPaymentCheckoutService MockService { get; }

        public static async Task<Harness> CreateAsync(
            ReservationStatus status = ReservationStatus.ApprovedAwaitingPayment)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"mock-payment-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var context = new KoochDbContext(options);
            var deadline = DateTime.UtcNow.AddHours(1);
            context.BookingSessions.Add(new BookingSession
            {
                Id = 1,
                SessionCode = SessionCode,
                ClientId = 1,
                PropertyId = 1,
                Currency = "IRR"
            });
            context.RoomTypes.AddRange(RoomType(10), RoomType(11));
            context.Reservations.AddRange(
                Reservation(100, 10, 100, deadline, status),
                Reservation(101, 11, 200, deadline, status));
            await context.SaveChangesAsync();

            var provider = new InternalTestPaymentProvider(SigningSecret);
            var paymentService = new PaymentService(
                context,
                new EffectiveAvailabilityService(context));
            var callbackService = new PaymentCallbackService(
                context,
                [provider],
                new PaymentDomainApplicationHandler(
                    context,
                    new EffectiveAvailabilityService(context)));
            return new Harness(
                context,
                new AccountBookingSessionPaymentService(context, paymentService, [provider]),
                new MockPaymentCheckoutService(context, provider, callbackService));
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();

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
            DateTime deadline,
            ReservationStatus status) => new()
        {
            Id = id,
            BookingSessionId = 1,
            ReservationNumber = $"KCH-R-{id}",
            ClientId = 1,
            PropertyId = 1,
            RoomTypeId = roomTypeId,
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 2),
            AdultCount = 1,
            TotalPrice = amount,
            FinalAmount = amount,
            Currency = "IRR",
            Status = status,
            Source = ReservationSource.Website,
            PaymentExpiresAtUtc = deadline
        };
    }
}
