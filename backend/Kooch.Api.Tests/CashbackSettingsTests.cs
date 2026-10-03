using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Cashback;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CashbackSettingsTests
{
    private static KoochDbContext CreateDb() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase($"cashback-{Guid.NewGuid():N}").Options);

    private static UpdateCashbackPolicyRequest Percentage(string currency = "IRR", decimal? rate = 10m,
        decimal? cap = 100_000m, int? expiry = 30) =>
        new(currency, true, CashbackCalculationMode.Percentage, rate, null, null, cap, expiry);

    private static UpdateCashbackPolicyRequest Fixed(string currency = "IRR", decimal? unit = 1_000_000m,
        decimal? reward = 100_000m, decimal? cap = 300_000m, int? expiry = 30) =>
        new(currency, true, CashbackCalculationMode.FixedPerUnit, null, unit, reward, cap, expiry);

    private static UpdatePropertyCashbackRequest PropertyPolicy(PropertyCashbackState state,
        CashbackCalculationMode? mode = null, decimal? rate = null, decimal? unit = null,
        decimal? reward = null, decimal? cap = null, int? expiry = null, string currency = "IRR") =>
        new(currency, state, mode, rate, unit, reward, cap, expiry);

    [Fact]
    public async Task GlobalDisabledAndPercentagePolicy_ArePersistedAndResolved()
    {
        await using var db = CreateDb();
        var service = new CashbackSettingsService(db);
        var disabled = await service.UpdateGlobalAsync(new(" irr ", false, null, null, null, null, null, null));
        Assert.False(disabled.Enabled);
        Assert.Equal("IRR", disabled.Currency);
        var enabled = await service.UpdateGlobalAsync(Percentage());
        Assert.Equal(10m, enabled.PercentageRate);
        Assert.Equal(CashbackPolicySource.Global, enabled.Source);
        db.ChangeTracker.Clear();
        Assert.Equal(enabled, await service.GetGlobalAsync("irr"));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(20.01)]
    public async Task PercentageOutsideSafetyRange_IsRejected(decimal rate)
    {
        await using var db = CreateDb();
        await Assert.ThrowsAsync<ArgumentException>(() => new CashbackSettingsService(db).UpdateGlobalAsync(Percentage(rate: rate)));
        Assert.Empty(db.CashbackSettings);
    }

    [Fact]
    public async Task PercentageRequiresRateAndForbidsFixedFields()
    {
        await using var db = CreateDb();
        var service = new CashbackSettingsService(db);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateGlobalAsync(Percentage(rate: null)));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateGlobalAsync(Percentage() with { SpendUnitAmount = 1 }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateGlobalAsync(Percentage(rate: 0.001m)));
    }

    [Theory]
    [InlineData(0, 100)]
    [InlineData(-1, 100)]
    [InlineData(100, 0)]
    [InlineData(100, -1)]
    public async Task FixedPerUnitRejectsNonPositiveFields(decimal unit, decimal reward)
    {
        await using var db = CreateDb();
        await Assert.ThrowsAsync<ArgumentException>(() => new CashbackSettingsService(db).UpdateGlobalAsync(Fixed(unit: unit, reward: reward)));
    }

    [Fact]
    public async Task FixedPerUnit_AcceptsCompletePolicy_AndForbidsPercentageField()
    {
        await using var db = CreateDb();
        var service = new CashbackSettingsService(db);
        var result = await service.UpdateGlobalAsync(Fixed());
        Assert.Equal(1_000_000m, result.SpendUnitAmount);
        Assert.Equal(100_000m, result.RewardAmount);
        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateGlobalAsync(Fixed() with { PercentageRate = 10 }));
    }

    [Theory]
    [InlineData(0, 30)]
    [InlineData(-1, 30)]
    [InlineData(100, 0)]
    [InlineData(100, -1)]
    public async Task EnabledPolicyRequiresPositiveCapAndExpiry(decimal cap, int expiry)
    {
        await using var db = CreateDb();
        await Assert.ThrowsAsync<ArgumentException>(() => new CashbackSettingsService(db).UpdateGlobalAsync(Percentage(cap: cap, expiry: expiry)));
    }

    [Fact]
    public async Task CurrencyIsNormalizedAndPoliciesDoNotBleed()
    {
        await using var db = CreateDb();
        var service = new CashbackSettingsService(db);
        await service.UpdateGlobalAsync(Percentage("irr", 10));
        await service.UpdateGlobalAsync(Fixed("USD"));
        Assert.Equal(10m, (await service.GetGlobalAsync(" IRR ")).PercentageRate);
        Assert.Equal(CashbackCalculationMode.FixedPerUnit, (await service.GetGlobalAsync("USD")).CalculationMode);
        Assert.False((await service.GetGlobalAsync("EUR")).Enabled);
        await Assert.ThrowsAsync<ArgumentException>(() => service.GetGlobalAsync("IR1"));
    }

    [Fact]
    public async Task PropertyPrecedence_InheritDisableOverrideRestore_TracksCurrentGlobal()
    {
        await using var db = CreateDb();
        db.Properties.Add(new Property { Id = 7, Name = "Property" });
        await db.SaveChangesAsync();
        var service = new CashbackSettingsService(db);
        await service.UpdateGlobalAsync(Percentage(rate: 10));
        Assert.Equal(PropertyCashbackState.Inherit, (await service.GetPropertyAsync(7, "IRR")).State);
        Assert.Equal(10m, (await service.GetEffectiveCashbackPolicyAsync(7, "IRR")).PercentageRate);
        await service.UpdatePropertyAsync(7, PropertyPolicy(PropertyCashbackState.Disabled));
        var disabled = await service.GetEffectiveCashbackPolicyAsync(7, "IRR");
        Assert.False(disabled.Enabled);
        Assert.Equal(CashbackPolicySource.PropertyDisabled, disabled.Source);
        await service.UpdatePropertyAsync(7, PropertyPolicy(PropertyCashbackState.EnabledOverride,
            CashbackCalculationMode.Percentage, rate: 5, cap: 100, expiry: 5));
        await service.UpdateGlobalAsync(Percentage(rate: 15));
        var overridden = await service.GetEffectiveCashbackPolicyAsync(7, "IRR");
        Assert.Equal(CashbackPolicySource.PropertyOverride, overridden.Source);
        Assert.Equal(5m, overridden.PercentageRate);
        await service.UpdatePropertyAsync(7, PropertyPolicy(PropertyCashbackState.Inherit));
        var inherited = await service.GetEffectiveCashbackPolicyAsync(7, "IRR");
        Assert.Equal(CashbackPolicySource.Global, inherited.Source);
        Assert.Equal(15m, inherited.PercentageRate);
    }

    [Fact]
    public async Task PropertyFixedOverride_IsCurrencyScoped()
    {
        await using var db = CreateDb();
        db.Properties.Add(new Property { Id = 7, Name = "Property" });
        await db.SaveChangesAsync();
        var service = new CashbackSettingsService(db);
        await service.UpdatePropertyAsync(7, PropertyPolicy(PropertyCashbackState.EnabledOverride,
            CashbackCalculationMode.FixedPerUnit, unit: 100, reward: 10, cap: 50, expiry: 20, currency: "USD"));
        Assert.Equal(CashbackCalculationMode.FixedPerUnit,
            (await service.GetEffectiveCashbackPolicyAsync(7, "USD")).CalculationMode);
        Assert.False((await service.GetEffectiveCashbackPolicyAsync(7, "IRR")).Enabled);
    }

    [Fact]
    public async Task ConfigurationUpdate_DoesNotCreateFinanceOrWalletRecords()
    {
        await using var db = CreateDb();
        db.SiteSettings.Add(new SiteSetting
        {
            Key = CommissionPolicyResolver.DirectSettingKey,
            Value = "12.5",
            Group = "Finance",
            Label = "Commission"
        });
        db.PropertyCommissionRates.Add(new PropertyCommissionRate
        {
            PropertyId = 7,
            CommissionType = CommissionType.Direct,
            Rate = 7m
        });
        await db.SaveChangesAsync();
        var service = new CashbackSettingsService(db);
        await service.UpdateGlobalAsync(Percentage());
        Assert.Empty(db.WalletEntries);
        Assert.Empty(db.WalletLots);
        Assert.Empty(db.FinancialEntries);
        Assert.Empty(db.ReservationFinancialSnapshots);
        Assert.Equal(7m, (await db.PropertyCommissionRates.SingleAsync()).Rate);
        Assert.Equal("12.5", (await db.SiteSettings.SingleAsync()).Value);
        Assert.Empty(db.Reservations);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Controller_AdminAssistantRequiresManageSettings_ForBothWrites(bool allowed)
    {
        await using var db = CreateDb();
        db.Properties.Add(new Property { Id = 7, Name = "Property" });
        await db.SaveChangesAsync();
        var controller = new AdminCashbackSettingsController(new CashbackSettingsService(db), new PermissionStub(allowed));
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, "2"),
                new Claim(ClaimTypes.Role, nameof(UserRole.AdminAssistant))], "test"))
        } };
        if (!allowed)
        {
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.UpdateGlobal(Percentage(), CancellationToken.None));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => controller.UpdateProperty(7,
                PropertyPolicy(PropertyCashbackState.Disabled), CancellationToken.None));
            Assert.Empty(db.CashbackSettings);
        }
        else
        {
            Assert.IsType<OkObjectResult>((await controller.UpdateGlobal(Percentage(), CancellationToken.None)).Result);
            Assert.IsType<OkObjectResult>((await controller.UpdateProperty(7,
                PropertyPolicy(PropertyCashbackState.Disabled), CancellationToken.None)).Result);
        }
    }

    [Fact]
    public async Task Controller_SuperAdminCanReadAndWriteWithoutExplicitManageSettingsGrant()
    {
        await using var db = CreateDb();
        db.Properties.Add(new Property { Id = 7, Name = "Property" });
        await db.SaveChangesAsync();
        var controller = new AdminCashbackSettingsController(new CashbackSettingsService(db), new PermissionStub(false));
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, "1"),
                new Claim(ClaimTypes.Role, nameof(UserRole.SuperAdmin))], "test"))
        } };
        Assert.IsType<OkObjectResult>((await controller.UpdateGlobal(Percentage(), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.UpdateProperty(7,
            PropertyPolicy(PropertyCashbackState.Disabled), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetGlobal("IRR", CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetProperty(7, "IRR", CancellationToken.None)).Result);
    }

    private sealed class PermissionStub(bool allowed) : IPermissionService
    {
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(allowed && permissionKey == PermissionKey.ManageSettings);
    }
}
