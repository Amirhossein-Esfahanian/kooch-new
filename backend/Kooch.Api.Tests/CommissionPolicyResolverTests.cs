using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CommissionPolicyResolverTests
{
    [Theory]
    [InlineData(CommissionType.Direct, CommissionPolicyResolver.DirectSettingKey)]
    [InlineData(CommissionType.PropertyReferralLink, CommissionPolicyResolver.PropertyReferralLinkSettingKey)]
    [InlineData(CommissionType.PropertyReferralCode, CommissionPolicyResolver.PropertyReferralCodeSettingKey)]
    public async Task GlobalPolicy_MapsEachCommissionTypeToItsCanonicalSetting(
        CommissionType commissionType,
        string expectedSettingKey)
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(expectedSettingKey, "12.50");

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(commissionType),
            grossAmount: 100m);

        Assert.Equal(commissionType, result.CommissionType);
        Assert.Equal(CommissionRateSource.Global, result.CommissionRateSource);
        Assert.Equal(12.50m, result.CommissionRate);
        Assert.Equal(expectedSettingKey, result.CommissionPolicySource);
    }

    [Fact]
    public async Task EnabledPropertyOverride_WinsOverGlobalPolicy()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "20");
        harness.AddOverride(CommissionType.Direct, 7.5m, isEnabled: true, id: 41);

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 200m);

        Assert.Equal(CommissionRateSource.PropertyOverride, result.CommissionRateSource);
        Assert.Equal(7.5m, result.CommissionRate);
        Assert.Equal("PropertyCommissionRate:41", result.CommissionPolicySource);
    }

    [Fact]
    public async Task DisabledPropertyOverride_FallsBackToGlobalPolicy()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "18");
        harness.AddOverride(CommissionType.Direct, 7m, isEnabled: false);

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 100m);

        Assert.Equal(CommissionRateSource.Global, result.CommissionRateSource);
        Assert.Equal(18m, result.CommissionRate);
    }

    [Fact]
    public async Task MissingPropertyOverride_FallsBackToGlobalPolicy()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "15");

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 100m);

        Assert.Equal(CommissionRateSource.Global, result.CommissionRateSource);
        Assert.Equal(15m, result.CommissionRate);
    }

    [Theory]
    [InlineData("0", 0, 100)]
    [InlineData("100", 100, 0)]
    public async Task BoundaryCommissionRates_AreValid(
        string configuredRate,
        decimal expectedCommission,
        decimal expectedPayable)
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, configuredRate);

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 100m);

        Assert.Equal(expectedCommission, result.CommissionAmount);
        Assert.Equal(expectedPayable, result.PropertyPayableAmount);
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("-0.01")]
    [InlineData("100.01")]
    public async Task InvalidGlobalSetting_FailsExplicitly(string configuredRate)
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, configuredRate);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Resolver.ResolveAsync(CreateReservation(CommissionType.Direct), 100m));
    }

    [Fact]
    public async Task MissingGlobalSetting_FailsExplicitly()
    {
        await using var harness = CreateHarness();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Resolver.ResolveAsync(CreateReservation(CommissionType.Direct), 100m));
    }

    [Fact]
    public async Task InvalidEnabledPropertyOverride_FailsInsteadOfFallingBack()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "10");
        harness.AddOverride(CommissionType.Direct, 101m, isEnabled: true);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Resolver.ResolveAsync(CreateReservation(CommissionType.Direct), 100m));
    }

    [Fact]
    public async Task NegativeGrossAmount_FailsExplicitly()
    {
        await using var harness = CreateHarness();

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
            harness.Resolver.ResolveAsync(CreateReservation(CommissionType.Direct), -0.01m));
    }

    [Fact]
    public async Task GrossAmount_IsUsedDirectlyAsCommissionBase()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "10");
        var reservation = CreateReservation(CommissionType.Direct);
        reservation.BaseAmount = 1m;
        reservation.DiscountAmount = 999m;
        reservation.ExtraGuestAmount = 777m;
        reservation.ServiceFeeAmount = 555m;
        reservation.ManualAdjustment = -333m;
        reservation.TotalPrice = 2m;
        reservation.FinalAmount = 3m;

        var result = await harness.Resolver.ResolveAsync(reservation, grossAmount: 250m);

        Assert.Equal(250m, result.GrossAmount);
        Assert.Equal(250m, result.CommissionBase);
        Assert.Equal(25m, result.CommissionAmount);
        Assert.Equal(225m, result.PropertyPayableAmount);
    }

    [Fact]
    public async Task MidpointCommission_RoundsAwayFromZero()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "12.50");

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 1m);

        Assert.Equal(0.13m, result.CommissionAmount);
        Assert.Equal(0.87m, result.PropertyPayableAmount);
    }

    [Fact]
    public async Task NonMidpointCommission_UsesTwoDecimalRounding()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "12.34");

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 100.01m);

        Assert.Equal(12.34m, result.CommissionAmount);
        Assert.Equal(87.67m, result.PropertyPayableAmount);
    }

    [Fact]
    public async Task Calculation_PreservesExactGrossInvariant()
    {
        await using var harness = CreateHarness();
        harness.AddGlobalSetting(CommissionPolicyResolver.DirectSettingKey, "33.33");

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 1234.56m);

        Assert.Equal(
            result.GrossAmount,
            result.CommissionAmount + result.PropertyPayableAmount);
    }

    [Fact]
    public async Task Result_ReturnsStablePolicyVersionMetadata()
    {
        await using var harness = CreateHarness();
        var timestamp = new DateTime(2026, 9, 24, 10, 30, 0, DateTimeKind.Utc);
        harness.AddGlobalSetting(
            CommissionPolicyResolver.DirectSettingKey,
            "10",
            createdAtUtc: timestamp);

        var result = await harness.Resolver.ResolveAsync(
            CreateReservation(CommissionType.Direct),
            grossAmount: 100m);

        Assert.Equal("2026-09-24T10:30:00.0000000Z", result.CommissionPolicyVersion);
    }

    private static Reservation CreateReservation(CommissionType commissionType) =>
        new()
        {
            PropertyId = 10,
            CommissionType = commissionType
        };

    private static CommissionResolverHarness CreateHarness() => new();

    private sealed class CommissionResolverHarness : IAsyncDisposable
    {
        public CommissionResolverHarness()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            Context = new KoochDbContext(options);
            Resolver = new CommissionPolicyResolver(Context);
        }

        public KoochDbContext Context { get; }
        public CommissionPolicyResolver Resolver { get; }

        public void AddGlobalSetting(
            string key,
            string value,
            DateTime? createdAtUtc = null)
        {
            Context.SiteSettings.Add(new SiteSetting
            {
                Key = key,
                Value = value,
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = key,
                IsActive = true,
                CreatedAtUtc = createdAtUtc ?? DateTime.UtcNow
            });
            Context.SaveChanges();
        }

        public void AddOverride(
            CommissionType commissionType,
            decimal rate,
            bool isEnabled,
            int id = 0)
        {
            Context.PropertyCommissionRates.Add(new PropertyCommissionRate
            {
                Id = id,
                PropertyId = 10,
                CommissionType = commissionType,
                Rate = rate,
                IsEnabled = isEnabled,
                CreatedAtUtc = DateTime.UtcNow
            });
            Context.SaveChanges();
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }
}
