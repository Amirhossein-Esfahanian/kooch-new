using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCommissionClassificationPersistenceTests
{
    [Fact]
    public void CommissionType_UsesStablePersistedValues()
    {
        Assert.Equal(0, (int)CommissionType.Direct);
        Assert.Equal(1, (int)CommissionType.PropertyReferralLink);
        Assert.Equal(2, (int)CommissionType.PropertyReferralCode);
    }

    [Fact]
    public void NewReservation_DefaultsToDirectCommissionType()
    {
        var reservation = new Reservation();

        Assert.Equal(CommissionType.Direct, reservation.CommissionType);
    }

    [Fact]
    public void ReservationCommissionType_IsRequiredAndHasDirectDatabaseDefault()
    {
        using var context = CreateMetadataContext();
        var entityType = context.GetService<IDesignTimeModel>()
            .Model
            .FindEntityType(typeof(Reservation));
        Assert.NotNull(entityType);

        var property = entityType.FindProperty(nameof(Reservation.CommissionType));
        Assert.NotNull(property);
        Assert.False(property.IsNullable);
        Assert.Equal(typeof(CommissionType), property.ClrType);
        Assert.Equal(CommissionType.Direct, property.GetDefaultValue());
    }

    [Fact]
    public void DatabaseDefault_PersistsExistingStyleReservationAsDirect()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection)
            .Options;
        using var context = new KoochDbContext(options);
        context.Database.EnsureCreated();
        context.Database.ExecuteSqlRaw("PRAGMA foreign_keys = OFF;");

        context.Database.ExecuteSqlInterpolated($"""
            INSERT INTO Reservations (
                ClientId,
                PropertyId,
                RoomTypeId,
                CheckInDate,
                CheckOutDate,
                AdultCount,
                ChildCount,
                TotalPrice,
                BaseAmount,
                DiscountAmount,
                ExtraGuestAmount,
                ServiceFeeAmount,
                ManualAdjustment,
                FinalAmount,
                Currency,
                Status,
                Source,
                RowVersion,
                CreatedAtUtc,
                IsDeleted)
            VALUES (
                {1},
                {1},
                {1},
                {new DateOnly(2026, 1, 1)},
                {new DateOnly(2026, 1, 2)},
                {1},
                {0},
                {100m},
                {100m},
                {0m},
                {0m},
                {0m},
                {0m},
                {100m},
                {"IRR"},
                {(int)ReservationStatus.Pending},
                {(int)ReservationSource.Website},
                {new byte[] { 1 }},
                {DateTime.UtcNow},
                {false});
            """);

        var reservation = context.Reservations.IgnoreQueryFilters().Single();
        Assert.Equal(CommissionType.Direct, reservation.CommissionType);
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
    }
}
