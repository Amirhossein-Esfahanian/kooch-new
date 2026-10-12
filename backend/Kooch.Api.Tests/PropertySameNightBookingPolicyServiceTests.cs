using Kooch.Api.Entities;
using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySameNightBookingPolicyServiceTests
{
    private static readonly DateOnly HotelNight = new(2026, 10, 12);

    [Theory]
    [InlineData(12, 19, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(12, 19, 30, SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(12, 20, 0, SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(12, 21, 30, SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(12, 22, 30, SameNightBookingPolicyResult.Closed)]
    [InlineData(12, 22, 31, SameNightBookingPolicyResult.Closed)]
    public void ConfiguredOvernightPolicy_UsesTehranDeadlineBoundaries(
        int utcDay, int utcHour, int utcMinute, SameNightBookingPolicyResult expected)
    {
        Assert.Equal(expected, Evaluate(OvernightProperty(), HotelNight, Utc(utcDay, utcHour, utcMinute)));
    }

    [Fact]
    public void FutureHotelNight_IsNotAffectedByTheCurrentNightsDeadline()
    {
        Assert.Equal(SameNightBookingPolicyResult.InstantEligible,
            Evaluate(OvernightProperty(), HotelNight.AddDays(1), Utc(12, 20, 0)));
    }

    [Fact]
    public void UnconfiguredPolicy_LeavesInstantBookingEligible()
    {
        Assert.Equal(SameNightBookingPolicyResult.InstantEligible,
            Evaluate(new Property(), HotelNight, Utc(13, 22, 31)));
    }

    [Theory]
    [InlineData(19, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(19, 30, SameNightBookingPolicyResult.RequiresApproval)]
    [InlineData(22, 31, SameNightBookingPolicyResult.RequiresApproval)]
    public void InstantOnly_DowngradesButDoesNotClose(
        int utcHour, int utcMinute, SameNightBookingPolicyResult expected)
    {
        var property = new Property
        {
            SameNightInstantBookingTime = new TimeOnly(23, 0),
            SameNightInstantBookingDayOffset = 0
        };
        Assert.Equal(expected, Evaluate(property, HotelNight, Utc(12, utcHour, utcMinute)));
    }

    [Theory]
    [InlineData(22, 29, SameNightBookingPolicyResult.InstantEligible)]
    [InlineData(22, 30, SameNightBookingPolicyResult.Closed)]
    public void FinalOnly_ClosesAtItsCutoff(
        int utcHour, int utcMinute, SameNightBookingPolicyResult expected)
    {
        var property = new Property
        {
            SameNightFinalBookingTime = new TimeOnly(2, 0),
            SameNightFinalBookingDayOffset = 1
        };
        Assert.Equal(expected, Evaluate(property, HotelNight, Utc(12, utcHour, utcMinute)));
    }

    [Fact]
    public void EqualDeadlines_FinalCutoffWinsAtTheBoundary()
    {
        var property = new Property
        {
            SameNightInstantBookingTime = new TimeOnly(23, 0),
            SameNightInstantBookingDayOffset = 0,
            SameNightFinalBookingTime = new TimeOnly(23, 0),
            SameNightFinalBookingDayOffset = 0
        };
        Assert.Equal(SameNightBookingPolicyResult.Closed,
            Evaluate(property, HotelNight, Utc(12, 19, 30)));
    }

    [Fact]
    public void TehranMidnightBoundary_UsesHotelNightEvenWhenUtcDateDiffers()
    {
        var property = new Property
        {
            SameNightFinalBookingTime = new TimeOnly(0, 0),
            SameNightFinalBookingDayOffset = 1
        };
        Assert.Equal(SameNightBookingPolicyResult.InstantEligible,
            Evaluate(property, HotelNight, Utc(12, 20, 29)));
        Assert.Equal(SameNightBookingPolicyResult.Closed,
            Evaluate(property, HotelNight, Utc(12, 20, 30)));
    }

    [Fact]
    public void Evaluation_CapturesInjectedUtcClockExactlyOnce()
    {
        var clock = new CountingTimeProvider(Utc(12, 21, 30));
        var service = new PropertySameNightBookingPolicyService(clock);

        Assert.Equal(SameNightBookingPolicyResult.RequiresApproval,
            service.Evaluate(OvernightProperty(), HotelNight));
        Assert.Equal(1, clock.CallCount);
    }

    [Fact]
    public void InvalidStoredDeadlinePair_IsRejectedRatherThanIgnored()
    {
        var property = new Property { SameNightInstantBookingTime = new TimeOnly(23, 0) };
        Assert.Throws<ArgumentException>(() => Evaluate(property, HotelNight, Utc(12, 19, 0)));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(2)]
    public void InvalidStoredDayOffset_IsRejected(int offset)
    {
        var property = new Property
        {
            SameNightFinalBookingTime = new TimeOnly(2, 0),
            SameNightFinalBookingDayOffset = (short)offset
        };
        Assert.Throws<ArgumentOutOfRangeException>(() => Evaluate(property, HotelNight, Utc(12, 19, 0)));
    }

    [Fact]
    public void InstantAfterFinal_IsRejectedRatherThanNormalized()
    {
        var property = new Property
        {
            SameNightInstantBookingTime = new TimeOnly(23, 0),
            SameNightInstantBookingDayOffset = 1,
            SameNightFinalBookingTime = new TimeOnly(2, 0),
            SameNightFinalBookingDayOffset = 1
        };
        Assert.Throws<ArgumentException>(() => Evaluate(property, HotelNight, Utc(12, 19, 0)));
    }

    [Fact]
    public void Resolution_HasNoDatabaseDependencyOrReceptionInputs()
    {
        var property = OvernightProperty();
        property.RegularReceptionFrom = new TimeOnly(14, 0);
        property.RegularReceptionUntil = new TimeOnly(14, 0);
        var constructor = Assert.Single(typeof(PropertySameNightBookingPolicyService).GetConstructors());
        Assert.Equal(new[] { typeof(TimeProvider) }, constructor.GetParameters().Select(p => p.ParameterType));
        Assert.Equal(SameNightBookingPolicyResult.RequiresApproval,
            Evaluate(property, HotelNight, Utc(12, 21, 30)));
    }

    private static SameNightBookingPolicyResult Evaluate(Property property, DateOnly night, DateTimeOffset nowUtc) =>
        new PropertySameNightBookingPolicyService(new CountingTimeProvider(nowUtc)).Evaluate(property, night);

    private static Property OvernightProperty() => new()
    {
        SameNightInstantBookingTime = new TimeOnly(23, 0),
        SameNightInstantBookingDayOffset = 0,
        SameNightFinalBookingTime = new TimeOnly(2, 0),
        SameNightFinalBookingDayOffset = 1
    };

    private static DateTimeOffset Utc(int day, int hour, int minute) =>
        new(2026, 10, day, hour, minute, 0, TimeSpan.Zero);

    private sealed class CountingTimeProvider(DateTimeOffset nowUtc) : TimeProvider
    {
        public int CallCount { get; private set; }

        public override DateTimeOffset GetUtcNow()
        {
            CallCount++;
            return nowUtc;
        }
    }
}
