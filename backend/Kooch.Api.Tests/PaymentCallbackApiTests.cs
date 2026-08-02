using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PaymentCallbackApiTests
{
    [Fact]
    public void CallbackEndpoint_IsProviderSpecificAnonymousAndRateLimited()
    {
        var controllerRoute = Assert.Single(
            typeof(PaymentCallbacksController).GetCustomAttributes<RouteAttribute>());
        var method = typeof(PaymentCallbacksController).GetMethod(nameof(PaymentCallbacksController.Receive))
            ?? throw new InvalidOperationException("Callback endpoint was not found.");
        var methodRoute = Assert.Single(method.GetCustomAttributes<HttpPostAttribute>());
        var rateLimit = Assert.Single(method.GetCustomAttributes<EnableRateLimitingAttribute>());

        Assert.Equal("api/payments/callbacks", controllerRoute.Template);
        Assert.Equal("{providerName}", methodRoute.Template);
        Assert.Equal(PaymentCallbackRateLimitPolicy.Name, rateLimit.PolicyName);
        Assert.NotNull(typeof(PaymentCallbacksController).GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public async Task RawRequest_IsPassedUnchangedWithoutFrontendDtoBinding()
    {
        var rawBody = JsonSerializer.SerializeToUtf8Bytes(new
        {
            provider_payload = "unchanged"
        });
        var service = new RecordingCallbackService();
        var controller = CreateController(service, rawBody, "signature-value");

        var action = await controller.Receive("registered-provider", CancellationToken.None);

        Assert.IsType<OkObjectResult>(action.Result);
        Assert.Equal("registered-provider", service.ProviderName);
        Assert.Equal(rawBody, service.Context!.Body.ToArray());
        Assert.Equal("signature-value", service.Context.Headers["X-Provider-Signature"]);
        Assert.Equal(IPAddress.Loopback.ToString(), service.Context.RemoteAddress);
    }

    [Fact]
    public async Task UnknownProvider_ReturnsSafeNotFoundResponse()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        var controller = harness.Controller(harness.CallbackBody(), "valid-signature");

        var action = await controller.Receive("unknown-provider", CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(action.Result);
        AssertSafeError(notFound.Value, "callback_target_not_found", "unknown-provider");
    }

    [Fact]
    public async Task InvalidSignature_IsRejectedWithoutPersistingAReceipt()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        var controller = harness.Controller(harness.CallbackBody(), "invalid-signature");

        var action = await controller.Receive(InternalTestPaymentProvider.ProviderName, CancellationToken.None);

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(action.Result);
        AssertSafeError(unauthorized.Value, "callback_validation_failed", CallbackApiHarness.SigningSecret);
        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task ValidAndDuplicateCallbacks_ApplyAllReservationsExactlyOnce()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        var body = harness.CallbackBody();

        var first = await harness.Controller(body, harness.Signature(body)).Receive(
            InternalTestPaymentProvider.ProviderName,
            CancellationToken.None);
        var duplicate = await harness.Controller(body, harness.Signature(body)).Receive(
            InternalTestPaymentProvider.ProviderName,
            CancellationToken.None);

        var firstResponse = Assert.IsType<PaymentCallbackResponse>(
            Assert.IsType<OkObjectResult>(first.Result).Value);
        var duplicateResponse = Assert.IsType<PaymentCallbackResponse>(
            Assert.IsType<OkObjectResult>(duplicate.Result).Value);
        Assert.Equal("applied", firstResponse.State);
        Assert.False(firstResponse.IsDuplicate);
        Assert.Equal("applied", duplicateResponse.State);
        Assert.True(duplicateResponse.IsDuplicate);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
        Assert.All(
            await harness.Context.Reservations.ToListAsync(),
            reservation => Assert.Equal(ReservationStatus.Confirmed, reservation.Status));
        Assert.Equal(2, await harness.Context.AuditLogs.CountAsync());
        Assert.Equal(2, await harness.Context.NotificationLogs.CountAsync());
    }

    [Fact]
    public async Task AmountMismatch_ReturnsSafeConflictWithoutAReceipt()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        var body = harness.CallbackBody(amount: 301);

        var action = await harness.Controller(body, harness.Signature(body)).Receive(
            InternalTestPaymentProvider.ProviderName,
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(action.Result);
        AssertSafeError(conflict.Value, "callback_mismatch", "301");
        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task CurrencyMismatch_ReturnsSafeConflictWithoutAReceipt()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        var body = harness.CallbackBody(currency: "USD");

        var action = await harness.Controller(body, harness.Signature(body)).Receive(
            InternalTestPaymentProvider.ProviderName,
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(action.Result);
        AssertSafeError(conflict.Value, "callback_mismatch", "USD");
        Assert.Empty(await harness.Context.PaymentCallbackReceipts.ToListAsync());
    }

    [Fact]
    public async Task DomainFailure_ReturnsAcceptedForReconciliationWithoutPartialApplication()
    {
        await using var harness = await CallbackApiHarness.CreateAsync();
        (await harness.Context.Reservations.FindAsync(11))!.Status = ReservationStatus.Rejected;
        await harness.Context.SaveChangesAsync();
        var body = harness.CallbackBody();

        var action = await harness.Controller(body, harness.Signature(body)).Receive(
            InternalTestPaymentProvider.ProviderName,
            CancellationToken.None);

        var accepted = Assert.IsType<AcceptedResult>(action.Result);
        var response = Assert.IsType<PaymentCallbackResponse>(accepted.Value);
        Assert.Equal("pending_reconciliation", response.State);
        Assert.Single(await harness.Context.PaymentCallbackReceipts.ToListAsync());
        Assert.Equal(
            ReservationStatus.ApprovedAwaitingPayment,
            (await harness.Context.Reservations.FindAsync(10))!.Status);
        Assert.Equal(ReservationStatus.Rejected, (await harness.Context.Reservations.FindAsync(11))!.Status);
        Assert.Empty(await harness.Context.AuditLogs.ToListAsync());
        Assert.Empty(await harness.Context.NotificationLogs.ToListAsync());
    }

    [Fact]
    public async Task CallbackRateLimit_IsPartitionedByProviderAndRemoteAddress()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(
            PaymentCallbackRateLimitPolicy.CreatePartition);
        var context = CreateRateLimitContext("provider-a", IPAddress.Loopback);
        var accepted = new List<RateLimitLease>();
        for (var attempt = 0; attempt < PaymentCallbackRateLimitPolicy.PermitLimit; attempt++)
        {
            var lease = await limiter.AcquireAsync(context);
            accepted.Add(lease);
            Assert.True(lease.IsAcquired);
        }

        using var rejected = await limiter.AcquireAsync(context);
        using var otherProvider = await limiter.AcquireAsync(
            CreateRateLimitContext("provider-b", IPAddress.Loopback));
        using var otherAddress = await limiter.AcquireAsync(
            CreateRateLimitContext("provider-a", IPAddress.Parse("127.0.0.2")));

        Assert.False(rejected.IsAcquired);
        Assert.True(otherProvider.IsAcquired);
        Assert.True(otherAddress.IsAcquired);
        accepted.ForEach(lease => lease.Dispose());
    }

    [Fact]
    public async Task UnexpectedException_DoesNotExposeRawBodySecretOrException()
    {
        var rawBody = Encoding.UTF8.GetBytes("raw-body-secret");
        var service = new RecordingCallbackService
        {
            Exception = new Exception("stack-secret-value")
        };
        var controller = CreateController(service, rawBody, "header-secret-value");

        var action = await controller.Receive("registered-provider", CancellationToken.None);

        var failure = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status500InternalServerError, failure.StatusCode);
        var serialized = JsonSerializer.Serialize(failure.Value);
        Assert.Contains("callback_processing_failed", serialized);
        Assert.DoesNotContain("raw-body-secret", serialized);
        Assert.DoesNotContain("header-secret-value", serialized);
        Assert.DoesNotContain("stack-secret-value", serialized);
    }

    private static PaymentCallbacksController CreateController(
        IPaymentCallbackService service,
        byte[] body,
        string signature)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Connection.RemoteIpAddress = IPAddress.Loopback;
        httpContext.Request.Body = new MemoryStream(body);
        httpContext.Request.ContentLength = body.Length;
        httpContext.Request.Headers["X-Provider-Signature"] = signature;
        httpContext.Request.Headers[InternalTestPaymentProvider.SignatureHeaderName] = signature;
        return new PaymentCallbacksController(
            service,
            NullLogger<PaymentCallbacksController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext }
        };
    }

    private static DefaultHttpContext CreateRateLimitContext(string provider, IPAddress address)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = address;
        context.Request.RouteValues["providerName"] = provider;
        return context;
    }

    private static void AssertSafeError(object? value, string code, string secret)
    {
        var error = Assert.IsType<PaymentCallbackErrorResponse>(value);
        Assert.Equal(code, error.Code);
        Assert.DoesNotContain(secret, JsonSerializer.Serialize(error), StringComparison.OrdinalIgnoreCase);
    }

    private sealed class RecordingCallbackService : IPaymentCallbackService
    {
        public string? ProviderName { get; private set; }
        public PaymentProviderCallbackContext? Context { get; private set; }
        public Exception? Exception { get; init; }

        public Task<PaymentCallbackResult> ReceiveAsync(
            string providerName,
            PaymentProviderCallbackContext context,
            CancellationToken cancellationToken = default)
        {
            ProviderName = providerName;
            Context = context;
            if (Exception is not null)
            {
                throw Exception;
            }

            return Task.FromResult(new PaymentCallbackResult
            {
                PaymentId = 1,
                ReceiptId = 1,
                ApplicationState = PaymentCallbackApplicationState.Received
            });
        }

        public Task<PaymentCallbackResult> RetryApplicationAsync(
            int paymentId,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class CallbackApiHarness : IAsyncDisposable
    {
        internal const string SigningSecret = "local-api-test-secret";

        private CallbackApiHarness(KoochDbContext context, PaymentCallbackService service)
        {
            Context = context;
            Service = service;
        }

        public KoochDbContext Context { get; }
        private PaymentCallbackService Service { get; }

        public static async Task<CallbackApiHarness> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"payment-callback-api-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var context = new KoochDbContext(options);
            var deadline = DateTime.UtcNow.AddHours(1);
            context.BookingSessions.Add(new BookingSession
            {
                Id = 1,
                SessionCode = "KCH-S-API",
                ClientId = 1,
                PropertyId = 1,
                Currency = "IRR"
            });
            context.RoomTypes.AddRange(RoomType(10), RoomType(11));
            context.Reservations.AddRange(
                Reservation(10, 100, deadline),
                Reservation(11, 200, deadline));
            context.Payments.Add(new Payment
            {
                Id = 100,
                BookingSessionId = 1,
                Amount = 300,
                Currency = "IRR",
                Provider = InternalTestPaymentProvider.ProviderName,
                IdempotencyKey = "api-payment-key",
                RequestHash = new string('A', 64),
                Status = PaymentStatus.Pending,
                Items =
                [
                    new PaymentItem { Id = 1000, ReservationId = 10, AllocatedAmount = 100, Currency = "IRR" },
                    new PaymentItem { Id = 1001, ReservationId = 11, AllocatedAmount = 200, Currency = "IRR" }
                ]
            });
            await context.SaveChangesAsync();
            var service = new PaymentCallbackService(
                context,
                [new InternalTestPaymentProvider(SigningSecret)],
                new PaymentDomainApplicationHandler(
                    context,
                    new EffectiveAvailabilityService(context)));
            return new CallbackApiHarness(context, service);
        }

        public PaymentCallbacksController Controller(byte[] body, string signature) =>
            CreateController(Service, body, signature);

        public byte[] CallbackBody(decimal amount = 300, string currency = "IRR") =>
            InternalTestPaymentProvider.SerializePayload(new InternalTestPaymentCallbackPayload
            {
                PaymentId = 100,
                ProviderEventId = "api-event-1",
                TransactionReference = "api-transaction-1",
                Amount = amount,
                Currency = currency,
                IsSuccessful = true,
                ProviderOccurredAtUtc = DateTime.UtcNow
            });

        public string Signature(byte[] body) =>
            InternalTestPaymentProvider.CreateSignature(body, SigningSecret);

        public ValueTask DisposeAsync() => Context.DisposeAsync();

        private static RoomType RoomType(int id) =>
            new()
            {
                Id = id,
                PropertyId = 1,
                Name = $"Room type {id}",
                Slug = $"room-type-{id}",
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            };

        private static Reservation Reservation(int id, decimal amount, DateTime deadline) =>
            new()
            {
                Id = id,
                BookingSessionId = 1,
                ReservationNumber = $"KCH-R-{id}",
                ClientId = 1,
                PropertyId = 1,
                RoomTypeId = id,
                CheckInDate = new DateOnly(2036, 1, 1),
                CheckOutDate = new DateOnly(2036, 1, 2),
                AdultCount = 1,
                TotalPrice = amount,
                FinalAmount = amount,
                Currency = "IRR",
                Status = ReservationStatus.ApprovedAwaitingPayment,
                Source = ReservationSource.Website,
                PaymentExpiresAtUtc = deadline
            };
    }
}
