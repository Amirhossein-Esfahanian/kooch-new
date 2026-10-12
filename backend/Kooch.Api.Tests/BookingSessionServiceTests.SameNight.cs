using System.Text.Json;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed partial class BookingSessionServiceTests
{
    [Theory]
    [InlineData(false, 22, 31, 1, ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(true, 19, 29, 1, ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(true, 19, 30, 1, ReservationStatus.PendingApproval)]
    [InlineData(true, 20, 0, 1, ReservationStatus.PendingApproval)]
    [InlineData(true, 21, 30, 1, ReservationStatus.PendingApproval)]
    [InlineData(true, 20, 0, 2, ReservationStatus.ApprovedAwaitingPayment)]
    public async Task SameNight_AccountStandardAndRatePlanShareAuthoritativeMode(
        bool configured, int utcHour, int utcMinute, int checkInDay, ReservationStatus expected)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness, configured);
        var policy = new ObservedSameNightPolicy(new SameNightClock(utcHour, utcMinute));
        await using var scope = harness.CreateService(sameNightPolicy: policy);
        var standard = CreateAccountItem(10, null);
        var alternative = CreateAccountItem(10, null);
        alternative.RatePlanId = 50;
        standard.CheckInDate = alternative.CheckInDate = new DateOnly(2035, 2, checkInDay);

        var result = await scope.Service.CreateForAccountAsync(1, CreateAccountRequest(standard, alternative));

        Assert.Equal(2, result.Reservations.Count);
        Assert.All(result.Reservations, reservation => Assert.Equal(expected, reservation.Status));
        Assert.Equal((1, standard.CheckInDate), Assert.Single(policy.Calls));
        await using var verification = harness.CreateContext();
        var saved = await verification.Reservations.OrderBy(reservation => reservation.Id).ToListAsync();
        Assert.All(saved, reservation =>
        {
            Assert.Equal(100m, reservation.FinalAmount);
            Assert.Equal(1, reservation.AdultCount);
            Assert.Equal(0, reservation.ChildCount);
            Assert.Equal(expected == ReservationStatus.PendingApproval, reservation.ApprovalExpiresAtUtc.HasValue);
            Assert.Equal(expected == ReservationStatus.ApprovedAwaitingPayment, reservation.PaymentExpiresAtUtc.HasValue);
        });
        var planReservation = Assert.Single(saved, reservation => reservation.RatePlanId == 50);
        Assert.Equal("Without breakfast", planReservation.RatePlanNameSnapshot);
        Assert.Equal("Room only", planReservation.MealPlanNameSnapshot);
        Assert.Equal(-20m, planReservation.RatePlanPriceModifierValueSnapshot);
        Assert.Equal(expected == ReservationStatus.PendingApproval ? 2 : 0,
            scope.NotificationDispatcher.PendingApprovalReservationIds.Count);
        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10], standard.CheckInDate, standard.CheckOutDate);
        Assert.All(availability[10].Nights.Values, night =>
            Assert.Equal(expected == ReservationStatus.PendingApproval ? 2 : 0, night.RemainingCapacity));
    }

    [Theory]
    [InlineData(22, 30, false, false)]
    [InlineData(22, 31, false, false)]
    [InlineData(22, 30, true, false)]
    [InlineData(22, 31, true, false)]
    [InlineData(22, 30, false, true)]
    [InlineData(22, 30, true, true)]
    public async Task SameNight_FinalCutoffRejectsNewAccountSessionAndSurfaces409(
        int utcHour, int utcMinute, bool ratePlan, bool calendarOnRequest)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        if (calendarOnRequest)
            await AddSameNightAvailabilityAsync(harness, AvailabilityStatus.OnRequest);
        var policy = new ObservedSameNightPolicy(new SameNightClock(utcHour, utcMinute));
        await using var scope = harness.CreateService(sameNightPolicy: policy);
        var item = CreateAccountItem(10, null);
        item.RatePlanId = ratePlan ? 50 : null;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, CreateAccountRequest(item)));

        Assert.Contains("same-night final booking cutoff", error.Message);
        Assert.Single(policy.Calls);
        var exceptionContext = new ExceptionContext(new ActionContext(
            new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), []) { Exception = error };
        new ApiExceptionFilter().OnException(exceptionContext);
        var response = Assert.IsType<ObjectResult>(exceptionContext.Result);
        Assert.Equal(StatusCodes.Status409Conflict, response.StatusCode);
        Assert.Equal(error.Message, JsonSerializer.SerializeToElement(response.Value).GetProperty("message").GetString());
        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
        Assert.Empty(scope.NotificationDispatcher.PendingApprovalReservationIds);
    }

    [Theory]
    [InlineData(19, 29)]
    [InlineData(20, 0)]
    public async Task SameNight_CalendarOnRequestOnLaterStayNightIsPreserved(int hour, int minute)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        await AddSameNightAvailabilityAsync(harness, AvailabilityStatus.OnRequest);
        await using var scope = harness.CreateService(sameNightPolicy:
            new ObservedSameNightPolicy(new SameNightClock(hour, minute)));

        var result = await scope.Service.CreateForAccountAsync(1, CreateAccountRequest(CreateAccountItem(10, 100)));

        Assert.Equal(ReservationStatus.PendingApproval, Assert.Single(result.Reservations).Status);
    }

    [Theory]
    [InlineData("closed")]
    [InlineData("unavailable")]
    [InlineData("zero")]
    [InlineData("consumed")]
    [InlineData("named-room-claimed")]
    public async Task SameNight_AvailabilityRecheckRejectsBeforePolicyResolution(string blockedBy)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        await using (var setup = harness.CreateContext())
        {
            if (blockedBy is "consumed" or "named-room-claimed")
            {
                var existing = CreateConsumingReservation(10);
                if (blockedBy == "consumed")
                    (await setup.RoomTypes.SingleAsync(room => room.Id == 10)).TotalInventory = 1;
                else
                    existing.RoomId = 100;
                setup.Reservations.Add(existing);
            }
            else
            {
                setup.Availabilities.Add(new Availability
                {
                    RoomTypeId = 10, Date = new(2035, 2, 2),
                    Status = blockedBy == "unavailable" ? AvailabilityStatus.Unavailable : AvailabilityStatus.Available,
                    IsClosed = blockedBy == "closed", AvailableCount = blockedBy == "zero" ? 0 : 2
                });
            }
            await setup.SaveChangesAsync();
        }
        var policy = new ObservedSameNightPolicy(new SameNightClock(20, 0));
        await using var scope = harness.CreateService(sameNightPolicy: policy);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, CreateAccountRequest(CreateAccountItem(10, 100))));

        Assert.Contains("Availability changed", error.Message);
        Assert.Empty(policy.Calls);
        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Theory]
    [InlineData(19, 29, 19, 30, ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(19, 29, 22, 30, ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(21, 30, 22, 31, ReservationStatus.PendingApproval)]
    public async Task SameNight_IdempotentReplayAfterDeadlinePreservesSessionAndWindows(
        int firstHour, int firstMinute, int replayHour, int replayMinute, ReservationStatus expected)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        var clock = new SameNightClock(firstHour, firstMinute);
        var policy = new ObservedSameNightPolicy(clock);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        int sessionId;
        DateTime? paymentDeadline;
        DateTime? approvalDeadline;
        await using (var firstScope = harness.CreateService(sameNightPolicy: policy))
        {
            var first = await firstScope.Service.CreateForAccountAsync(1, request);
            sessionId = first.BookingSessionId;
            Assert.Equal(expected, Assert.Single(first.Reservations).Status);
            await using var verification = harness.CreateContext();
            var saved = await verification.Reservations.SingleAsync();
            paymentDeadline = saved.PaymentExpiresAtUtc;
            approvalDeadline = saved.ApprovalExpiresAtUtc;
        }

        clock.Set(replayHour, replayMinute);
        await using var replayScope = harness.CreateService(sameNightPolicy: policy);
        var replay = await replayScope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(sessionId, replay.BookingSessionId);
        Assert.Equal(expected, Assert.Single(replay.Reservations).Status);
        Assert.Single(policy.Calls);
        Assert.Empty(replayScope.NotificationDispatcher.PendingApprovalReservationIds);
        await using var after = harness.CreateContext();
        var reservation = await after.Reservations.SingleAsync();
        Assert.Equal(expected, reservation.Status);
        Assert.Equal(paymentDeadline, reservation.PaymentExpiresAtUtc);
        Assert.Equal(approvalDeadline, reservation.ApprovalExpiresAtUtc);
        Assert.Single(await after.BookingSessions.ToListAsync());

        request.Items[0].Adults = 2;
        var conflict = await Assert.ThrowsAsync<InvalidOperationException>(() => replayScope.Service.CreateForAccountAsync(1, request));
        Assert.Contains("different booking payload", conflict.Message);
        Assert.Single(policy.Calls);
    }

    [Theory]
    [InlineData(19, 29, 19, 30, ReservationBookingModeFilter.Instant, false)]
    [InlineData(21, 30, 22, 30, ReservationBookingModeFilter.OnRequest, true)]
    public async Task SameNight_PublicQuoteBeforeDeadlineDoesNotAuthorizeLaterSession(
        int quoteHour, int quoteMinute, int createHour, int createMinute,
        ReservationBookingModeFilter quoteMode, bool rejected)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        var clock = new SameNightClock(quoteHour, quoteMinute);
        var policy = new ObservedSameNightPolicy(clock);
        await using (var context = harness.CreateContext())
        {
            var options = new PublicBookingOptionsService(context, new EffectiveAvailabilityService(context),
                new TestReservationPricingService(), new ChildPricingRuleResolver(context), policy);
            var quote = await options.GetAsync("property-one", new(2035, 2, 1), new(2035, 2, 3), 1, 0, []);
            Assert.Equal(quoteMode, Assert.Single(quote.RoomTypes, room => room.RoomTypeId == 10).BookingMode);
        }
        clock.Set(createHour, createMinute);
        await using var scope = harness.CreateService(sameNightPolicy: policy);
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        if (rejected)
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, request));
            Assert.Contains("same-night final booking cutoff", error.Message);
            await using var verification = harness.CreateContext();
            Assert.Empty(await verification.BookingSessions.ToListAsync());
            Assert.Empty(await verification.Reservations.ToListAsync());
        }
        else
        {
            var result = await scope.Service.CreateForAccountAsync(1, request);
            Assert.Equal(ReservationStatus.PendingApproval, Assert.Single(result.Reservations).Status);
        }
        Assert.Equal(2, policy.Calls.Count);
    }

    [Theory]
    [InlineData(19, 29, false)]
    [InlineData(20, 0, true)]
    public async Task SameNight_DistinctCheckInsResolveSeparatelyAndRetainMixedModeRejection(
        int hour, int minute, bool mixed)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        var policy = new ObservedSameNightPolicy(new SameNightClock(hour, minute));
        await using var scope = harness.CreateService(sameNightPolicy: policy);
        var later = CreateAccountItem(20, 200);
        later.CheckInDate = new(2035, 2, 2);
        var request = CreateAccountRequest(CreateAccountItem(10, 100), later);

        if (mixed)
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => scope.Service.CreateForAccountAsync(1, request));
            Assert.Contains("Instant and on-request reservations cannot be combined", error.Message);
            await using var verification = harness.CreateContext();
            Assert.Empty(await verification.Reservations.ToListAsync());
            Assert.Empty(await verification.BookingSessions.ToListAsync());
        }
        else
        {
            var result = await scope.Service.CreateForAccountAsync(1, request);
            Assert.All(result.Reservations, reservation => Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
        }
        Assert.Equal(new[] { (1, new DateOnly(2035, 2, 1)), (1, new DateOnly(2035, 2, 2)) }, policy.Calls);
    }

    [Fact]
    public async Task SameNight_InternalHistoricalCreationDoesNotEvaluatePolicy()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        var policy = new ObservedSameNightPolicy(new SameNightClock(22, 31));
        await using var scope = harness.CreateService(sameNightPolicy: policy);
        var item = CreateItem(10, 100);
        item.CheckInDate = new(2020, 1, 1);
        item.CheckOutDate = new(2020, 1, 3);

        var result = await scope.Service.CreateAsync(CreateRequest(item));

        Assert.Equal(ReservationStatus.Pending, Assert.Single(result.Reservations).Status);
        Assert.Empty(policy.Calls);
    }

    [Fact]
    public async Task SameNight_RealPricingAndGuestSnapshotsRemainIdenticalAcrossDowngrade()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await ConfigureSameNightAsync(harness);
        await using (var setup = harness.CreateContext())
        {
            var property = await setup.Properties.SingleAsync(item => item.Id == 1);
            property.FreeChildAgeLimit = 5;
            property.ChildPrice = 50;
            setup.SiteSettings.Add(new SiteSetting { Key = ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, Value = "12", IsActive = true });
            setup.RoomDailyPrices.AddRange(
                new RoomDailyPrice { RoomTypeId = 10, Date = new(2035, 2, 1), GuestType = PricingGuestType.Iranian, BasePrice = 120 },
                new RoomDailyPrice { RoomTypeId = 10, Date = new(2035, 2, 2), GuestType = PricingGuestType.Iranian, BasePrice = 180 });
            await setup.SaveChangesAsync();
        }
        var clock = new SameNightClock(19, 29);
        var policy = new ObservedSameNightPolicy(clock);
        var item = CreateAccountItem(10, null);
        item.RatePlanId = 50;
        item.Adults = 2;
        item.Children = 2;
        item.ChildAges = [4, 8];
        await using (var first = harness.CreateService(useAuthoritativePricing: true, sameNightPolicy: policy))
            await first.Service.CreateForAccountAsync(1, CreateAccountRequest(item));
        clock.Set(20, 0);
        await using (var second = harness.CreateService(useAuthoritativePricing: true, sameNightPolicy: policy))
            await second.Service.CreateForAccountAsync(1, CreateAccountRequest(item));

        await using var verification = harness.CreateContext();
        var saved = await verification.Reservations.OrderBy(reservation => reservation.Id).ToListAsync();
        Assert.Equal(new[] { ReservationStatus.ApprovedAwaitingPayment, ReservationStatus.PendingApproval }, saved.Select(r => r.Status));
        Assert.All(saved, r =>
        {
            Assert.Equal(360m, r.FinalAmount);
            Assert.Equal(360m, r.TotalPrice);
            Assert.Equal(2, r.AdultCount);
            Assert.Equal(2, r.ChildCount);
            Assert.Equal("Without breakfast", r.RatePlanNameSnapshot);
            Assert.Equal("Room only", r.MealPlanNameSnapshot);
        });
        Assert.Equal(saved[0].BaseAmount, saved[1].BaseAmount);
        Assert.Equal(saved[0].ExtraGuestAmount, saved[1].ExtraGuestAmount);
        Assert.Equal(saved[0].DiscountAmount, saved[1].DiscountAmount);
        Assert.Equal(saved[0].ServiceFeeAmount, saved[1].ServiceFeeAmount);
        Assert.All(BookingWalletFunding.Allocate(saved, 100m), allocation => Assert.Equal(360m, allocation.GuestPayable));
    }

    private static async Task ConfigureSameNightAsync(BookingSessionTestHarness harness, bool configured = true)
    {
        await using var context = harness.CreateContext();
        if (configured)
        {
            var property = await context.Properties.SingleAsync(item => item.Id == 1);
            property.SameNightInstantBookingTime = new(23, 0);
            property.SameNightInstantBookingDayOffset = 0;
            property.SameNightFinalBookingTime = new(2, 0);
            property.SameNightFinalBookingDayOffset = 1;
        }
        context.MealPlans.Add(new MealPlan { Id = 70, Name = "Room only", Slug = "room-only" });
        context.RatePlans.Add(new RatePlan
        {
            Id = 50, RoomTypeId = 10, Name = "Without breakfast", MealPlanId = 70,
            IsActive = true, PriceModifierType = PriceModifierType.FixedAmount, PriceModifierValue = -20
        });
        await context.SaveChangesAsync();
    }

    private static async Task AddSameNightAvailabilityAsync(BookingSessionTestHarness harness, AvailabilityStatus status)
    {
        await using var context = harness.CreateContext();
        context.Availabilities.Add(new Availability
        {
            RoomTypeId = 10, Date = new(2035, 2, 2), AvailableCount = 2, Status = status
        });
        await context.SaveChangesAsync();
    }

    private sealed class SameNightClock(int hour, int minute) : TimeProvider
    {
        private DateTimeOffset nowUtc = new(2035, 2, 1, hour, minute, 0, TimeSpan.Zero);
        public void Set(int newHour, int newMinute) => nowUtc = new(2035, 2, 1, newHour, newMinute, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => nowUtc;
    }

    private sealed class ObservedSameNightPolicy(TimeProvider clock) : IPropertySameNightBookingPolicyService
    {
        private readonly PropertySameNightBookingPolicyService inner = new(clock);
        public List<(int PropertyId, DateOnly CheckIn)> Calls { get; } = [];
        public SameNightBookingPolicyResult Evaluate(Property property, DateOnly requestedCheckIn)
        {
            Calls.Add((property.Id, requestedCheckIn));
            return inner.Evaluate(property, requestedCheckIn);
        }
    }
}
