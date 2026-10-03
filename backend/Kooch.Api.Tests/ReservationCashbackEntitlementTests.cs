using Kooch.Api.Data;
using Kooch.Api.Dtos.Cashback;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCashbackEntitlementTests
{
    private static readonly DateTime EligibleAt = new(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);

    private static PendingCashbackEntitlementInput Percentage(decimal amount = 10m) => new(
        3, 1, 2, " irr ", 100m, 0m, 100m, amount,
        CashbackPolicySource.Global, CashbackCalculationMode.Percentage,
        10m, null, null, 50m, 30, EligibleAt);

    private static PendingCashbackEntitlementInput Fixed(decimal amount = 200_000m) =>
        Percentage(amount) with
        {
            GuestPayableSnapshot = 2_900_000m,
            EligibleBaseSnapshot = 2_900_000m,
            CalculationMode = CashbackCalculationMode.FixedPerUnit,
            PercentageRateSnapshot = null,
            SpendUnitAmountSnapshot = 1_000_000m,
            RewardAmountSnapshot = 100_000m,
            MaxCashbackPerReservationSnapshot = 500_000m
        };

    [Fact]
    public async Task PercentageCreatesPendingWithCanonicalLinksAndSnapshots()
    {
        await using var db = await CreateDbAsync();
        var row = await new ReservationCashbackEntitlementService(db).CreatePendingAsync(Percentage());
        Assert.NotNull(row);
        Assert.Equal(CashbackEntitlementStatus.Pending, row.Status);
        Assert.Equal((3, 1, 2, "IRR"), (row.ReservationId, row.UserId, row.PropertyId, row.Currency));
        Assert.Equal((100m, 0m, 100m, 10m), (row.GuestPayableSnapshot,
            row.NonWithdrawableWalletFundingSnapshot, row.EligibleBaseSnapshot, row.CashbackAmount));
        Assert.Equal(CashbackPolicySource.Global, row.PolicySource);
        Assert.Equal(CashbackCalculationMode.Percentage, row.CalculationMode);
        Assert.Equal(EligibleAt, row.EligibleAtUtc);
        Assert.Null(row.GrantedWalletLotId);
        Assert.Null(row.GrantedWalletEntryId);
        Assert.Null(row.GrantedAtUtc);
        db.ChangeTracker.Clear();
        Assert.Equal("IRR", (await db.ReservationCashbackEntitlements.SingleAsync()).Currency);
    }

    [Fact]
    public async Task FixedPerUnitCreatesOnePendingEntitlementForCompleteUnitsOnly()
    {
        await using var db = await CreateDbAsync();
        var row = await new ReservationCashbackEntitlementService(db).CreatePendingAsync(Fixed());
        Assert.NotNull(row);
        Assert.Equal(200_000m, row.CashbackAmount);
        Assert.Equal(CashbackCalculationMode.FixedPerUnit, row.CalculationMode);
        Assert.Null(row.PercentageRateSnapshot);
    }

    [Theory]
    [InlineData(-1, 0, -1, 0)]
    [InlineData(100, -1, 101, 10)]
    [InlineData(100, 101, -1, 10)]
    [InlineData(100, 5, 96, 10)]
    [InlineData(100, 0, 100, -1)]
    public async Task InvalidFinancialSnapshotsAreRejected(decimal guest, decimal wallet, decimal eligible, decimal amount)
    {
        await using var db = await CreateDbAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => new ReservationCashbackEntitlementService(db)
            .CreatePendingAsync(Percentage(amount) with
            {
                GuestPayableSnapshot = guest,
                NonWithdrawableWalletFundingSnapshot = wallet,
                EligibleBaseSnapshot = eligible
            }));
        Assert.Empty(db.ReservationCashbackEntitlements);
    }

    [Fact]
    public async Task WalletFundingSubtractsOnlyFromSuppliedSnapshotAndMustReconcile()
    {
        await using var db = await CreateDbAsync();
        var input = Percentage(8m) with
        {
            GuestPayableSnapshot = 100m,
            NonWithdrawableWalletFundingSnapshot = 20m,
            EligibleBaseSnapshot = 80m
        };
        var row = await new ReservationCashbackEntitlementService(db).CreatePendingAsync(input);
        Assert.Equal(80m, row!.EligibleBaseSnapshot);
        Assert.Equal(8m, row.CashbackAmount);
    }

    public static TheoryData<PendingCashbackEntitlementInput> InvalidPolicies => new()
    {
        Percentage() with { PercentageRateSnapshot = null },
        Percentage() with { PercentageRateSnapshot = 0 },
        Percentage() with { PercentageRateSnapshot = 20.01m },
        Percentage() with { SpendUnitAmountSnapshot = 1 },
        Percentage() with { RewardAmountSnapshot = 1 },
        Percentage() with { MaxCashbackPerReservationSnapshot = 0 },
        Percentage() with { ExpiryDaysSnapshot = 0 },
        Percentage() with { PolicySource = CashbackPolicySource.PropertyDisabled },
        Percentage() with { Currency = "IR1" },
        Percentage() with { EligibleAtUtc = DateTime.SpecifyKind(EligibleAt, DateTimeKind.Local) },
        Fixed() with { SpendUnitAmountSnapshot = null },
        Fixed() with { RewardAmountSnapshot = null },
        Fixed() with { PercentageRateSnapshot = 10m }
    };

    [Theory]
    [MemberData(nameof(InvalidPolicies))]
    public async Task InvalidPolicyAndIdentityFieldsAreRejected(PendingCashbackEntitlementInput input)
    {
        await using var db = await CreateDbAsync();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            new ReservationCashbackEntitlementService(db).CreatePendingAsync(input));
        Assert.Empty(db.ReservationCashbackEntitlements);
    }

    [Fact]
    public async Task PercentageUsesAwayFromZeroAtMidpointAndRequiresExactSuppliedAmount()
    {
        await using var db = await CreateDbAsync();
        var input = Percentage(.13m) with
        {
            GuestPayableSnapshot = 1m,
            EligibleBaseSnapshot = 1m,
            PercentageRateSnapshot = 12.5m,
            MaxCashbackPerReservationSnapshot = 1m
        };
        await Assert.ThrowsAsync<ArgumentException>(() => new ReservationCashbackEntitlementService(db)
            .CreatePendingAsync(input with { CashbackAmount = .12m }));
        Assert.Equal(.13m, (await new ReservationCashbackEntitlementService(db).CreatePendingAsync(input))!.CashbackAmount);
    }

    [Fact]
    public async Task PercentageCapAppliesAfterRounding()
    {
        await using var db = await CreateDbAsync();
        var input = Percentage(.12m) with
        {
            GuestPayableSnapshot = 1m,
            EligibleBaseSnapshot = 1m,
            PercentageRateSnapshot = 12.5m,
            MaxCashbackPerReservationSnapshot = .12m
        };
        Assert.Equal(.12m, (await new ReservationCashbackEntitlementService(db).CreatePendingAsync(input))!.CashbackAmount);
    }

    [Fact]
    public async Task FixedPerUnitRejectsPartialUnitRewardAndAppliesCap()
    {
        await using var db = await CreateDbAsync();
        var input = Fixed(150_000m) with { MaxCashbackPerReservationSnapshot = 150_000m };
        await Assert.ThrowsAsync<ArgumentException>(() => new ReservationCashbackEntitlementService(db)
            .CreatePendingAsync(input with { CashbackAmount = 290_000m }));
        Assert.Equal(150_000m, (await new ReservationCashbackEntitlementService(db).CreatePendingAsync(input))!.CashbackAmount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ZeroCalculatedRewardReturnsNoEntitlement(bool fixedMode)
    {
        await using var db = await CreateDbAsync();
        var input = fixedMode
            ? Fixed(0) with { GuestPayableSnapshot = 900_000m, EligibleBaseSnapshot = 900_000m }
            : Percentage(0) with { GuestPayableSnapshot = 0m, EligibleBaseSnapshot = 0m };
        Assert.Null(await new ReservationCashbackEntitlementService(db).CreatePendingAsync(input));
        Assert.Empty(db.ReservationCashbackEntitlements);
    }

    [Fact]
    public async Task DuplicateForReservationIsRejected()
    {
        await using var db = await CreateDbAsync();
        var service = new ReservationCashbackEntitlementService(db);
        await service.CreatePendingAsync(Percentage());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreatePendingAsync(Percentage()));
        Assert.Single(db.ReservationCashbackEntitlements);
    }

    [Fact]
    public async Task CanonicalReservationIdentityMustMatch()
    {
        await using var db = await CreateDbAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => new ReservationCashbackEntitlementService(db)
            .CreatePendingAsync(Percentage() with { UserId = 99 }));
        Assert.Empty(db.ReservationCashbackEntitlements);
    }

    [Fact]
    public async Task CurrentGlobalAndPropertySettingsCanChangeWithoutChangingSnapshot()
    {
        await using var db = await CreateDbAsync();
        var settings = new CashbackSettingsService(db);
        await settings.UpdateGlobalAsync(new UpdateCashbackPolicyRequest("IRR", true,
            CashbackCalculationMode.Percentage, 10m, null, null, 50m, 30));
        await settings.UpdatePropertyAsync(2, new UpdatePropertyCashbackRequest("IRR",
            PropertyCashbackState.EnabledOverride, CashbackCalculationMode.Percentage,
            10m, null, null, 50m, 30));
        var row = await new ReservationCashbackEntitlementService(db).CreatePendingAsync(
            Percentage() with { PolicySource = CashbackPolicySource.PropertyOverride });
        await settings.UpdateGlobalAsync(new UpdateCashbackPolicyRequest("IRR", true,
            CashbackCalculationMode.Percentage, 5m, null, null, 50m, 15));
        await settings.UpdatePropertyAsync(2, new UpdatePropertyCashbackRequest("IRR",
            PropertyCashbackState.EnabledOverride, CashbackCalculationMode.Percentage,
            5m, null, null, 50m, 15));
        Assert.Equal(10m, row!.PercentageRateSnapshot);
        await settings.UpdatePropertyAsync(2, new UpdatePropertyCashbackRequest("IRR",
            PropertyCashbackState.Inherit, null, null, null, null, null, null));
        db.ChangeTracker.Clear();
        var persisted = await db.ReservationCashbackEntitlements.SingleAsync();
        Assert.Equal(10m, persisted.PercentageRateSnapshot);
        Assert.Equal(30, persisted.ExpiryDaysSnapshot);
        Assert.Equal(10m, persisted.CashbackAmount);
        Assert.Equal(CashbackPolicySource.PropertyOverride, persisted.PolicySource);
    }

    [Fact]
    public async Task PersistenceGuardRejectsFinancialAndPolicyMutationAndDeletion()
    {
        await using var db = await CreateDbAsync();
        var row = (await new ReservationCashbackEntitlementService(db).CreatePendingAsync(Percentage()))!;
        row.CashbackAmount = 11m;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.Entry(row).State = EntityState.Unchanged;
        row.PercentageRateSnapshot = 5m;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        db.Entry(row).State = EntityState.Unchanged;
        db.ReservationCashbackEntitlements.Remove(row);
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task DirectInsertCannotBypassPendingOrGrantLinkageFoundation()
    {
        await using var db = await CreateDbAsync();
        db.ReservationCashbackEntitlements.Add(new ReservationCashbackEntitlement
        {
            ReservationId = 3, UserId = 1, PropertyId = 2, Currency = "IRR",
            Status = CashbackEntitlementStatus.Granted, GrantedWalletLotId = 77,
            GrantedWalletEntryId = 78, GrantedAtUtc = EligibleAt
        });
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task CreationDoesNotTouchWalletFinanceOrCommission()
    {
        await using var db = await CreateDbAsync();
        db.SiteSettings.Add(new SiteSetting
        {
            Key = CommissionPolicyResolver.DirectSettingKey, Value = "12.5",
            Group = "Finance", Label = "Commission"
        });
        await db.SaveChangesAsync();
        var priorReservation = await db.Reservations.AsNoTracking().SingleAsync();
        await new ReservationCashbackEntitlementService(db).CreatePendingAsync(Percentage());
        Assert.Empty(db.WalletAccounts);
        Assert.Empty(db.WalletLots);
        Assert.Empty(db.WalletEntries);
        Assert.Empty(db.WalletHolds);
        Assert.Empty(db.FinancialEntries);
        Assert.Empty(db.ReservationFinancialSnapshots);
        Assert.Empty(db.Payments);
        Assert.Empty(db.RefundRecords);
        Assert.Equal("12.5", (await db.SiteSettings.SingleAsync()).Value);
        Assert.Empty(db.CashbackSettings);
        var currentReservation = await db.Reservations.AsNoTracking().SingleAsync();
        Assert.Equal(priorReservation.Status, currentReservation.Status);
        Assert.Equal(priorReservation.FinalAmount, currentReservation.FinalAmount);
        Assert.Equal(priorReservation.UpdatedAtUtc, currentReservation.UpdatedAtUtc);
    }

    [Fact]
    public void PersistenceModelHasOnePerReservationAndNonCascadingRelationships()
    {
        using var db = CreateDb();
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(ReservationCashbackEntitlement))!;
        Assert.Contains(entity.GetIndexes(), index => index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual([nameof(ReservationCashbackEntitlement.ReservationId)]));
        Assert.All(entity.GetForeignKeys(), key => Assert.Equal(DeleteBehavior.NoAction, key.DeleteBehavior));
        Assert.Equal(5, entity.GetForeignKeys().Count());
        foreach (var name in new[] { "Amounts", "Policy", "GrantLink", "NotDeleted", "Currency" })
            Assert.Contains(entity.GetCheckConstraints(), constraint =>
                constraint.Name == $"CK_ReservationCashbackEntitlements_{name}");
    }

    private static KoochDbContext CreateDb() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase($"cashback-entitlement-{Guid.NewGuid():N}").Options);

    private static async Task<KoochDbContext> CreateDbAsync()
    {
        var db = CreateDb();
        db.Users.Add(new User { Id = 1, FirstName = "Guest", LastName = "One" });
        db.Properties.Add(new Property { Id = 2, OwnerId = 1, Name = "Property" });
        db.Reservations.Add(new Reservation
        {
            Id = 3, ClientId = 1, PropertyId = 2, Currency = "IRR",
            Status = ReservationStatus.Paid, FinalAmount = 100m
        });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return db;
    }
}
