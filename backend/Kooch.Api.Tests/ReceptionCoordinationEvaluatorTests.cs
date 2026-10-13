using Kooch.Api.Services;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReceptionCoordinationEvaluatorTests
{
    [Theory]
    [InlineData(null, null, null, ReceptionCoordinationResult.NotConfigured)]
    [InlineData(null, null, "01:00", ReceptionCoordinationResult.NotConfigured)]
    [InlineData("14:00", "23:00", null, ReceptionCoordinationResult.ArrivalUnspecified)]
    [InlineData("14:00", "23:00", "13:59", ReceptionCoordinationResult.CoordinationRequired)]
    [InlineData("14:00", "23:00", "14:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("14:00", "23:00", "18:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("14:00", "23:00", "23:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("14:00", "23:00", "23:01", ReceptionCoordinationResult.CoordinationRequired)]
    [InlineData("22:00", "06:00", "21:59", ReceptionCoordinationResult.CoordinationRequired)]
    [InlineData("22:00", "06:00", "22:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("22:00", "06:00", "23:30", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("22:00", "06:00", "00:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("22:00", "06:00", "01:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("22:00", "06:00", "06:00", ReceptionCoordinationResult.InsideRegularReception)]
    [InlineData("22:00", "06:00", "06:01", ReceptionCoordinationResult.CoordinationRequired)]
    public void Evaluate_ReturnsRecurringClockTimeDecision(
        string? from, string? until, string? arrival, ReceptionCoordinationResult expected)
    {
        Assert.Equal(expected, ReceptionCoordinationEvaluator.Evaluate(Parse(from), Parse(until), Parse(arrival)));
    }

    [Theory]
    [InlineData("14:00", null)]
    [InlineData(null, "23:00")]
    [InlineData("14:00", "14:00")]
    public void InvalidConfiguration_FailsEvenWhenArrivalIsUnspecified(string? from, string? until)
    {
        Assert.Throws<ArgumentException>(() => ReceptionCoordinationEvaluator.Evaluate(Parse(from), Parse(until), null));
    }

    private static TimeOnly? Parse(string? value) => value is null ? null : TimeOnly.Parse(value);
}
