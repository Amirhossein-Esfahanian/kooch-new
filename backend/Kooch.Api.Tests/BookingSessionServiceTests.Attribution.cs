using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Attribution_NewAccount_AssignsOnePolicyToSessionAndAllReservations(bool direct)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(20, 200));
        if (direct) await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        await scope.Service.CreateForAccountAsync(1, request);
        await using var verify = harness.CreateContext();
        var session = await verify.BookingSessions.Include(row => row.Reservations).SingleAsync();
        var policy = direct ? CommissionType.PropertyReferralCode : CommissionType.Direct;
        Assert.Equal(policy, session.CommissionType);
        Assert.Equal(2, session.Reservations.Count);
        Assert.All(session.Reservations, row => Assert.Equal(policy, row.CommissionType));
        Assert.Empty(await verify.Payments.ToListAsync());
        Assert.Empty(await verify.FinancialEntries.ToListAsync());
    }

    [Theory]
    [InlineData("tampered")]
    [InlineData("expired")]
    [InlineData("wrong-user")]
    [InlineData("wrong-key")]
    [InlineData("wrong-property")]
    [InlineData("wrong-purpose")]
    [InlineData("missing-token")]
    [InlineData("blank-token")]
    [InlineData("missing-key")]
    [InlineData("invalid-property")]
    public async Task Attribution_InvalidDirectRequest_NeverFallsBackOrWrites(string invalid)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        switch (invalid)
        {
            case "tampered": request.PropertyDirectContext!.Token = "forged-token"; break;
            case "expired": tokens.Clock.Now = tokens.Clock.Now.AddHours(1); break;
            case "wrong-user":
                context.Users.Add(new User { Id = 2, FirstName = "Other", LastName = "Account" });
                await context.SaveChangesAsync();
                await tokens.Attach(request, userId: 2); break;
            case "wrong-key": request.IdempotencyKey = "changed-key"; break;
            case "wrong-property": await tokens.Attach(request, slug: "property-two"); break;
            case "wrong-purpose":
                request.PropertyDirectContext!.Token = tokens.Provider.CreateProtector("unrelated-purpose").Protect("{}"); break;
            case "missing-token": request.PropertyDirectContext!.Token = null; break;
            case "blank-token": request.PropertyDirectContext!.Token = " "; break;
            case "missing-key": request.IdempotencyKey = null; break;
            case "invalid-property": request.PropertyDirectContext!.PropertyId = 0; break;
        }
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        await Assert.ThrowsAsync<ArgumentException>(() => scope.Service.CreateForAccountAsync(1, request));
        await using var verify = harness.CreateContext();
        Assert.Empty(await verify.BookingSessions.ToListAsync());
        Assert.Empty(await verify.Reservations.ToListAsync());
        Assert.Empty(await verify.FinancialEntries.ToListAsync());
        Assert.Empty(await verify.ReservationActivities.ToListAsync());
    }

    [Fact]
    public async Task Attribution_TokenPropertyMustAlsoMatchEveryRoomAndRoomType()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var mixed = CreateAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(30, 300));
        await tokens.Attach(mixed);
        await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, mixed));
        var foreignRoom = CreateAccountRequest(CreateAccountItem(10, 300));
        await tokens.Attach(foreignRoom);
        await Assert.ThrowsAsync<ArgumentException>(() => scope.Service.CreateForAccountAsync(1, foreignRoom));
        Assert.Empty(await context.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task Attribution_ApprovalRevokedAfterIssue_BlocksNewButNotExistingReplay()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var existing = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(existing);
        var denied = CreateAccountRequest(CreateAccountItem(20, 200));
        await tokens.Attach(denied);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var created = await scope.Service.CreateForAccountAsync(1, existing);
        (await context.Properties.SingleAsync(row => row.Id == 1)).Status = PropertyStatus.Draft;
        await context.SaveChangesAsync();
        Assert.Equal(created.BookingSessionId, (await scope.Service.CreateForAccountAsync(1, existing)).BookingSessionId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, denied));
        Assert.Single(await context.BookingSessions.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Attribution_ExpiredOrTokenlessReplay_AfterDeactivation_ReturnsUnchangedSession(bool tokenless)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var first = await scope.Service.CreateForAccountAsync(1, request);
        var storedHash = (await context.BookingSessions.SingleAsync()).RequestHash;
        (await context.RoomTypes.SingleAsync(row => row.Id == 10)).IsActive = false;
        await context.SaveChangesAsync();
        tokens.Clock.Now = tokens.Clock.Now.AddHours(1);
        if (tokenless) request.PropertyDirectContext!.Token = null;
        await using var replayScope = harness.CreateService(directContexts: tokens.Service);
        Assert.Equal(first.BookingSessionId, (await replayScope.Service.CreateForAccountAsync(1, request)).BookingSessionId);
        await using var verify = harness.CreateContext();
        var persisted = await verify.BookingSessions.SingleAsync();
        Assert.Equal(storedHash, persisted.RequestHash);
        Assert.Equal(CommissionType.PropertyReferralCode, persisted.CommissionType);
        Assert.Equal(CommissionType.PropertyReferralCode, (await verify.Reservations.SingleAsync()).CommissionType);
        if (tokenless)
        {
            request.IdempotencyKey = "new-tokenless-key";
            (await context.RoomTypes.SingleAsync(row => row.Id == 10)).IsActive = true;
            await context.SaveChangesAsync();
            await Assert.ThrowsAsync<ArgumentException>(() => replayScope.Service.CreateForAccountAsync(1, request));
        }
    }

    [Fact]
    public async Task Attribution_RenewedToken_ReplaysButForgedReplayIsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var first = await scope.Service.CreateForAccountAsync(1, request);
        var originalToken = request.PropertyDirectContext!.Token;
        tokens.Clock.Now = tokens.Clock.Now.AddMinutes(10);
        await tokens.Attach(request);
        Assert.NotEqual(originalToken, request.PropertyDirectContext!.Token);
        Assert.Equal(first.BookingSessionId, (await scope.Service.CreateForAccountAsync(1, request)).BookingSessionId);
        request.PropertyDirectContext.Token = "tampered-on-replay";
        await Assert.ThrowsAsync<ArgumentException>(() => scope.Service.CreateForAccountAsync(1, request));
    }

    [Theory]
    [InlineData("user")]
    [InlineData("property")]
    [InlineData("key")]
    [InlineData("purpose")]
    public async Task Attribution_ReplayWithSuppliedToken_StillRequiresAuthenticBinding(string change)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        await scope.Service.CreateForAccountAsync(1, request);
        context.Users.Add(new User { Id = 2, FirstName = "Other", LastName = "Account" });
        await context.SaveChangesAsync();
        var replacement = await tokens.Service.IssueAsync(change == "user" ? 2 : 1, new()
        {
            PropertySlug = change == "property" ? "property-two" : "property-one",
            IdempotencyKey = change == "key" ? "unrelated-key" : request.IdempotencyKey!
        });
        request.PropertyDirectContext!.Token = change == "purpose"
            ? tokens.Provider.CreateProtector("other-purpose").Protect("{}") : replacement.Token;
        await Assert.ThrowsAsync<ArgumentException>(() => scope.Service.CreateForAccountAsync(1, request));
        Assert.Single(await context.BookingSessions.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Attribution_OtherTravelerAndStayGuests_ReplayWithChannelEnvelope(bool stayGuests)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(20, 200));
        if (stayGuests) request.StayGuests = new() { Adults = 2 };
        await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var first = await scope.Service.CreateForAccountAsync(1, request);
        request.PropertyDirectContext!.Token = null;
        Assert.Equal(first.BookingSessionId, (await scope.Service.CreateForAccountAsync(1, request)).BookingSessionId);
        request.PropertyDirectContext = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, request));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Attribution_ChannelChange_CannotBypassSelfGuestReplayFallback(bool originallyDirect)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        if (originallyDirect) await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        await scope.Service.CreateForAccountAsync(1, request);
        if (originallyDirect) request.PropertyDirectContext = null;
        else await tokens.Attach(request);
        await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, request));
        Assert.Single(await context.BookingSessions.ToListAsync());
    }

    [Theory]
    [InlineData("property")]
    [InlineData("dates")]
    [InlineData("guests")]
    [InlineData("rooms")]
    [InlineData("rate")]
    [InlineData("traveler")]
    public async Task Attribution_ChangedMeaningfulPayload_ConflictsEvenWithoutReplayToken(string change)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        await scope.Service.CreateForAccountAsync(1, request);
        request.PropertyDirectContext!.Token = null;
        switch (change)
        {
            case "property": request.PropertyDirectContext.PropertyId = 2; break;
            case "dates": request.Items[0].CheckOutDate = request.Items[0].CheckOutDate.AddDays(1); break;
            case "guests": request.Items[0].Adults = 2; break;
            case "rooms": request.Items = [CreateAccountItem(20, 200)]; break;
            case "rate": request.Items[0].RatePlanId = 99; break;
            case "traveler": request.BookingForSelf = false; request.PrimaryGuest = new()
                { FirstName = "Other", LastName = "Traveler", Email = "disposable@example.test" }; break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, request));
        Assert.Single(await context.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task Attribution_DirectSelfGuestAssociationChange_AndHistoricalNullMarketplace_ReplaySafely()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var guest = await context.Guests.SingleAsync();
        guest.UserId = null;
        await context.SaveChangesAsync();
        var tokens = new AttributionTokens(context);
        var direct = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(direct);
        await using var scope = harness.CreateService(directContexts: tokens.Service);
        var first = await scope.Service.CreateForAccountAsync(1, direct);
        var ownedGuest = await context.Guests.SingleAsync(row => row.UserId == 1);
        Assert.Equal(first.BookingSessionId, (await scope.Service.CreateForAccountAsync(1, direct)).BookingSessionId);
        var marketplace = CreateAccountRequest(CreateAccountItem(20, 200));
        var marketResult = await scope.Service.CreateForAccountAsync(1, marketplace);
        var legacy = await context.BookingSessions.SingleAsync(row => row.Id == marketResult.BookingSessionId);
        legacy.CommissionType = null;
        var internalRequest = new BookingSessionCreateRequest
        {
            ClientId = 1, GuestId = ownedGuest.Id, PropertyId = 1,
            Items = [new() { RoomTypeId = 20, RoomId = 200,
                CheckInDate = marketplace.Items[0].CheckInDate, CheckOutDate = marketplace.Items[0].CheckOutDate, Adults = 1 }]
        };
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("Account" + BookingSessionService.ComputeRequestHash(internalRequest)))),
            legacy.RequestHash);
        await context.SaveChangesAsync();
        Assert.Equal(marketResult.BookingSessionId, (await scope.Service.CreateForAccountAsync(1, marketplace)).BookingSessionId);
        await using var verify = harness.CreateContext();
        Assert.Null((await verify.BookingSessions.SingleAsync(row => row.Id == legacy.Id)).CommissionType);
    }

    [Fact]
    public async Task Attribution_FailedPricing_DoesNotPersistPartialAttribution()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100), CreateAccountItem(20, 200));
        await tokens.Attach(request);
        await using var scope = harness.CreateService(new TestReservationPricingService { ThrowOnPublicCall = 2 }, directContexts: tokens.Service);
        await Assert.ThrowsAsync<IncompleteDailyPricingException>(() => scope.Service.CreateForAccountAsync(1, request));
        Assert.Empty(await context.BookingSessions.ToListAsync());
        Assert.Empty(await context.Reservations.ToListAsync());
    }

    [Fact]
    public async Task Attribution_ConcurrentDuplicateRequests_CreateExactlyOneSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var tokens = new AttributionTokens(context);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        await tokens.Attach(request);
        await using var first = harness.CreateService(directContexts: tokens.Service);
        await using var second = harness.CreateService(directContexts: tokens.Service);
        var results = await Task.WhenAll(first.Service.CreateForAccountAsync(1, request), second.Service.CreateForAccountAsync(1, request));
        Assert.Equal(results[0].BookingSessionId, results[1].BookingSessionId);
        Assert.Single(await context.BookingSessions.ToListAsync());
        Assert.Single(await context.Reservations.ToListAsync());
    }

    [Fact]
    public void Attribution_RequestDoesNotAcceptPolicyOrPercentageInsideContext()
    {
        Assert.Equal(new[] { "PropertyId", "Token" }, typeof(AccountPropertyDirectBookingContextRequest).GetProperties().Select(p => p.Name));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<AccountPropertyDirectBookingContextRequest>(
            "{\"propertyId\":1,\"token\":\"x\",\"commissionType\":0}", new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }
}

internal sealed class AttributionTokens
{
    internal sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 3, 10, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }
    public TestClock Clock { get; } = new();
    public IDataProtectionProvider Provider { get; } = new EphemeralDataProtectionProvider();
    public PropertyDirectBookingContextService Service { get; }
    public AttributionTokens(KoochDbContext db) => Service = new(db, Provider, Options.Create(new PropertyDirectBookingContextOptions
        { KeyRingPath = Path.GetTempPath(), ApplicationName = "attribution-unit-tests" }), Clock);
    public async Task Attach(AccountBookingSessionCreateRequest request, int userId = 1, string slug = "property-one")
    {
        var issued = await Service.IssueAsync(userId, new() { PropertySlug = slug, IdempotencyKey = request.IdempotencyKey! });
        request.PropertyDirectContext = new() { PropertyId = issued.PropertyId, Token = issued.Token };
    }
}
