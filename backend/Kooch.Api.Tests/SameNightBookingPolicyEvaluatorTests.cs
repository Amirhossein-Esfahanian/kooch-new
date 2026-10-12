using Kooch.Api.Services;
using Kooch.Api.Services.Holidays;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SameNightBookingPolicyEvaluatorTests
{
    private static readonly DateOnly HotelNight = new(2026, 10, 12);
    private static readonly SameNightBookingDeadline Instant = new(new TimeOnly(23, 0), 0);
    private static readonly SameNightBookingDeadline Final = new(new TimeOnly(2, 0), 1);

    [Theory]
    [InlineData(19, 29, SameNightBookingPolicyResult.InstantEligible)] // 22:59 Tehran
    [InlineData(19, 30, SameNightBookingPolicyResult.RequiresApproval)] // 23:00 Tehran
    [InlineData(20, 0, SameNightBookingPolicyResult.RequiresApproval)] // 23:30 Tehran
    [InlineData(21, 30, SameNightBookingPolicyResult.RequiresApproval)] // 01:00 next day Tehran
    [InlineData(22, 30, SameNightBookingPolicyResult.Closed)] // 02:00 next day Tehran
    [InlineData(22, 31, SameNightBookingPolicyResult.Closed)] // 02:01 next day Tehran
    public void OvernightPolicy_UsesExactBoundariesAndTehranLocalNight(
        int utcHour,
        int utcMinute,
        SameNightBookingPolicyResult expected)
    {
        Assert.Equal(expected, Evaluate(HotelNight, Utc(12, utcHour, utcMinute), Instant, Final));
    }

    [Fact]
    public void FutureNight_IsNotDowngradedByTheCurrentNightsDeadline()
    {
        Assert.Equal(SameNightBookingPolicyResult.InstantEligible,
            Evaluate(HotelNight.AddDays(1), Utc(12, 20, 0), Instant, Final));
    }

    [Fact]
    public void HistoricalNight_AfterItsFinalCutoff_IsClosed()
    {
        Assert.Equal(SameNightBookingPolicyResult.Closed,
            Evaluate(HotelNight.AddDays(-1), Utc(12, 19, 29), Instant, Final));
    }

    [Theory]
    [InlineData(17, 29, SameNightBookingPolicyResult.InstantEligible)] // 20:59 Tehran
    [InlineData(17, 30, SameNightBookingPolicyResult.RequiresApproval)] // 21:00 Tehran
    [InlineData(19, 59, SameNightBookingPolicyResult.RequiresApproval)] // 23:29 Tehran
    [InlineData(20, 0, SameNightBookingPolicyResult.Closed)] // 23:30 Tehran
    public void SameDayDeadlines_AreComparedInChronologicalOrder(
        int utcHour,
        int utcMinute,
        SameNightBookingPolicyResult expected)
    {
        var instant = new SameNightBookingDeadline(new TimeOnly(21, 0), 0);
        var final = new SameNightBookingDeadline(new TimeOnly(23, 30), 0);
        Assert.Equal(expected, Evaluate(HotelNight, Utc(12, utcHour, utcMinute), instant, final));
    }

    [Theory]
    [InlineData(22, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(22, 30, SameNightBookingPolicyResult.Closed)]
    public void FinalOnly_DoesNotDowngradeBeforeClosing(
        int utcHour,
        int utcMinute,
        SameNightBookingPolicyResult expected)
    {
        Assert.Equal(expected, Evaluate(HotelNight, Utc(12, utcHour, utcMinute), null, Final));
    }

    [Theory]
    [InlineData(19, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(19, 30, SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(22, 31, SameNightBookingPolicyResult.RequiresApproval)]
    public void InstantOnly_NeverAutomaticallyCloses(
        int utcHour,
        int utcMinute,
        SameNightBookingPolicyResult expected)
    {
        Assert.Equal(expected, Evaluate(HotelNight, Utc(12, utcHour, utcMinute), Instant, null));
    }

    [Fact]
    public void BothDeadlinesAbsent_PreservesLegacyInstantEligibility()
    {
        Assert.Equal(SameNightBookingPolicyResult.InstantEligible,
            Evaluate(HotelNight, Utc(13, 22, 31), null, null));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(2)]
    public void InvalidDayOffset_IsRejectedForEitherDeadline(int dayOffset)
    {
        var invalid = new SameNightBookingDeadline(new TimeOnly(2, 0), dayOffset);
        Assert.Throws<ArgumentOutOfRangeException>(() => SameNightBookingPolicyEvaluator.Validate(invalid, null));
        Assert.Throws<ArgumentOutOfRangeException>(() => SameNightBookingPolicyEvaluator.Validate(null, invalid));
    }

    [Fact]
    public void InstantAfterFinal_IsRejected()
    {
        var invalidInstant = new SameNightBookingDeadline(new TimeOnly(23, 0), 1);
        var final = new SameNightBookingDeadline(new TimeOnly(2, 0), 1);
        Assert.Throws<ArgumentException>(() => SameNightBookingPolicyEvaluator.Validate(invalidInstant, final));
        Assert.Throws<ArgumentException>(() => Evaluate(HotelNight, Utc(12, 20, 0), invalidInstant, final));
    }

    [Theory]
    [InlineData(19, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(19, 30, SameNightBookingPolicyResult.Closed)]
    public void EqualDeadlines_FinalCutoffTakesPrecedence(
        int utcHour,
        int utcMinute,
        SameNightBookingPolicyResult expected)
    {
        Assert.Equal(expected, Evaluate(HotelNight, Utc(12, utcHour, utcMinute), Instant, Instant));
    }

    [Theory]
    [InlineData("Asia/Tehran")]
    [InlineData("Iran Standard Time")]
    public void ExistingIranTimezoneConvention_ResolvesBothIdentifiers(string timezoneId)
    {
        Assert.True(HolidayCalendarSyncSchedule.TryResolveIranTimeZone(timezoneId, out var zone));
        Assert.NotNull(zone);
        Assert.Equal(SameNightBookingPolicyResult.RequiresApproval,
            SameNightBookingPolicyEvaluator.Evaluate(
                HotelNight, Utc(12, 21, 30), zone, Instant, Final));
    }

    [Fact]
    public void EquivalentUtcInstants_AreIndependentOfInputOffset()
    {
        var nowWithOffset = Utc(12, 21, 30).ToOffset(TimeSpan.FromHours(3.5));
        Assert.Equal(SameNightBookingPolicyResult.RequiresApproval,
            Evaluate(HotelNight, nowWithOffset, Instant, Final));
    }

    private static SameNightBookingPolicyResult Evaluate(
        DateOnly hotelNight,
        DateTimeOffset nowUtc,
        SameNightBookingDeadline? instant,
        SameNightBookingDeadline? final)
    {
        Assert.True(HolidayCalendarSyncSchedule.TryResolveIranTimeZone("Asia/Tehran", out var zone));
        return SameNightBookingPolicyEvaluator.Evaluate(hotelNight, nowUtc, zone!, instant, final);
    }

    private static DateTimeOffset Utc(int day, int hour, int minute) =>
        new(2026, 10, day, hour, minute, 0, TimeSpan.Zero);
}
