using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationRatePlanSnapshotPersistenceTests
{
    [Fact]
    public void Migration_AddsOnlyFiveNullableSnapshotColumns()
    {
        var migration = new AddReservationRatePlanSnapshot();
        var columns = migration.UpOperations.OfType<AddColumnOperation>().ToArray();
        Assert.Equal(5, columns.Length);
        Assert.Equal(5, migration.UpOperations.Count);
        Assert.All(columns, column =>
        {
            Assert.Equal("Reservations", column.Table);
            Assert.True(column.IsNullable);
            Assert.Null(column.DefaultValue);
            Assert.Null(column.DefaultValueSql);
        });
        Assert.Equal("decimal(18,2)", Assert.Single(columns, column =>
            column.Name == nameof(Reservation.RatePlanPriceModifierValueSnapshot)).ColumnType);
    }

    [Fact]
    public void SnapshotModel_UsesNullableColumnsAndSourceCompatibleSizes()
    {
        using var db = CreateContext();
        var entity = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Reservation))!;

        Assert.Equal(150, entity.FindProperty(nameof(Reservation.RatePlanNameSnapshot))!.GetMaxLength());
        Assert.Equal(150, entity.FindProperty(nameof(Reservation.MealPlanNameSnapshot))!.GetMaxLength());
        Assert.Equal(170, entity.FindProperty(nameof(Reservation.MealPlanSlugSnapshot))!.GetMaxLength());
        var amount = entity.FindProperty(nameof(Reservation.RatePlanPriceModifierValueSnapshot))!;
        Assert.Equal(18, amount.GetPrecision());
        Assert.Equal(2, amount.GetScale());
        foreach (var name in SnapshotNames)
            Assert.True(entity.FindProperty(name)!.IsNullable);
    }

    [Fact]
    public async Task LegacyReservation_PersistsNullSnapshotsAndAllowsUnrelatedUpdate()
    {
        await using var db = CreateContext();
        db.Reservations.Add(NewReservation());
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var reservation = await db.Reservations.SingleAsync();
        Assert.Null(reservation.RatePlanId);
        Assert.Null(reservation.RatePlanNameSnapshot);
        Assert.Null(reservation.MealPlanNameSnapshot);
        Assert.Null(reservation.MealPlanSlugSnapshot);
        Assert.Null(reservation.RatePlanPriceModifierTypeSnapshot);
        Assert.Null(reservation.RatePlanPriceModifierValueSnapshot);
        reservation.GuestNote = "ordinary update";
        await db.SaveChangesAsync();
        Assert.Equal("ordinary update", (await db.Reservations.SingleAsync()).GuestNote);
    }

    [Theory]
    [InlineData(-300000)]
    [InlineData(0)]
    [InlineData(200000)]
    public async Task Snapshot_PersistsSignedFixedModifierIndependentOfLivePlan(decimal modifier)
    {
        await using var db = CreateContext();
        var meal = new MealPlan { Name = "Breakfast", Slug = "breakfast" };
        var plan = new RatePlan
        {
            Name = "Standard",
            MealPlan = meal,
            RoomTypeId = 1,
            PriceModifierType = PriceModifierType.FixedAmount,
            PriceModifierValue = modifier
        };
        db.RatePlans.Add(plan);
        var reservation = NewReservation();
        reservation.RatePlan = plan;
        reservation.RatePlanNameSnapshot = "Standard";
        reservation.MealPlanNameSnapshot = "Breakfast";
        reservation.MealPlanSlugSnapshot = "breakfast";
        reservation.RatePlanPriceModifierTypeSnapshot = PriceModifierType.FixedAmount;
        reservation.RatePlanPriceModifierValueSnapshot = modifier;
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync();

        plan.Name = "Renamed";
        plan.PriceModifierValue = 999;
        meal.Name = "Changed meal";
        meal.Slug = "changed-meal";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var saved = await db.Reservations.Include(item => item.RatePlan).SingleAsync();
        Assert.Equal("Standard", saved.RatePlanNameSnapshot);
        Assert.Equal("Breakfast", saved.MealPlanNameSnapshot);
        Assert.Equal("breakfast", saved.MealPlanSlugSnapshot);
        Assert.Equal(PriceModifierType.FixedAmount, saved.RatePlanPriceModifierTypeSnapshot);
        Assert.Equal(modifier, saved.RatePlanPriceModifierValueSnapshot);
        Assert.Equal("Renamed", saved.RatePlan!.Name);
    }

    [Theory]
    [InlineData("RatePlanNameSnapshot")]
    [InlineData("MealPlanNameSnapshot")]
    [InlineData("MealPlanSlugSnapshot")]
    [InlineData("RatePlanPriceModifierTypeSnapshot")]
    [InlineData("RatePlanPriceModifierValueSnapshot")]
    public async Task PersistedSnapshot_CannotBeChanged(string field)
    {
        await using var db = CreateContext();
        var reservation = NewReservation();
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        reservation = await db.Reservations.SingleAsync();
        switch (field)
        {
            case "RatePlanNameSnapshot": reservation.RatePlanNameSnapshot = "Changed"; break;
            case "MealPlanNameSnapshot": reservation.MealPlanNameSnapshot = "Changed"; break;
            case "MealPlanSlugSnapshot": reservation.MealPlanSlugSnapshot = "changed"; break;
            case "RatePlanPriceModifierTypeSnapshot": reservation.RatePlanPriceModifierTypeSnapshot = PriceModifierType.FixedAmount; break;
            case "RatePlanPriceModifierValueSnapshot": reservation.RatePlanPriceModifierValueSnapshot = -1; break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }

    private static readonly string[] SnapshotNames =
    [
        nameof(Reservation.RatePlanNameSnapshot),
        nameof(Reservation.MealPlanNameSnapshot),
        nameof(Reservation.MealPlanSlugSnapshot),
        nameof(Reservation.RatePlanPriceModifierTypeSnapshot),
        nameof(Reservation.RatePlanPriceModifierValueSnapshot)
    ];

    private static Reservation NewReservation() => new()
    {
        ClientId = 1,
        PropertyId = 1,
        RoomTypeId = 1,
        CheckInDate = new DateOnly(2026, 10, 10),
        CheckOutDate = new DateOnly(2026, 10, 11),
        Currency = "IRR"
    };

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"reservation-rate-plan-snapshot-{Guid.NewGuid():N}")
            .Options);
}
