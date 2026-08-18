using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionPersistenceTests
{
    [Fact]
    public void BookingSession_HasTheApprovedPersistenceShape()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(BookingSession));

        Assert.NotNull(entityType);
        Assert.Equal(32, entityType.FindProperty(nameof(BookingSession.SessionCode))?.GetMaxLength());
        Assert.False(entityType.FindProperty(nameof(BookingSession.SessionCode))?.IsNullable);
        Assert.Equal(3, entityType.FindProperty(nameof(BookingSession.Currency))?.GetMaxLength());
        Assert.False(entityType.FindProperty(nameof(BookingSession.Currency))?.IsNullable);
        Assert.Equal(200, entityType.FindProperty(nameof(BookingSession.IdempotencyKey))?.GetMaxLength());
        Assert.Equal(128, entityType.FindProperty(nameof(BookingSession.RequestHash))?.GetMaxLength());
        Assert.True(entityType.FindProperty(nameof(BookingSession.ExpectedArrivalTime))?.IsNullable);
        Assert.Equal("time", entityType.FindProperty(nameof(BookingSession.ExpectedArrivalTime))?.GetColumnType());
        Assert.Null(entityType.FindProperty("Status"));
        Assert.Null(entityType.FindProperty("ExpiresAtUtc"));
        Assert.Null(entityType.FindProperty("LeadReservationId"));
    }

    [Fact]
    public void BookingSession_UsesUniquePublicAndIdempotencyIndexes()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(BookingSession));
        Assert.NotNull(entityType);

        var sessionCodeIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(BookingSession.SessionCode)]));
        Assert.True(sessionCodeIndex.IsUnique);

        var idempotencyIndex = Assert.Single(
            entityType.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(BookingSession.ClientId), nameof(BookingSession.IdempotencyKey)]));
        Assert.True(idempotencyIndex.IsUnique);
        Assert.Equal(
            "[IdempotencyKey] IS NOT NULL AND [IdempotencyKey] <> ''",
            idempotencyIndex.GetFilter());
    }

    [Fact]
    public void BookingSession_RowVersion_IsConfiguredForOptimisticConcurrency()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(BookingSession));
        Assert.NotNull(entityType);

        var rowVersion = entityType.FindProperty(nameof(BookingSession.RowVersion));
        Assert.NotNull(rowVersion);
        Assert.True(rowVersion.IsConcurrencyToken);
        Assert.Equal(ValueGenerated.OnAddOrUpdate, rowVersion.ValueGenerated);
    }

    [Fact]
    public void Reservation_BookingSessionRelationship_IsOptionalAndNonCascading()
    {
        using var context = CreateMetadataContext();
        var reservationType = context.Model.FindEntityType(typeof(Reservation));
        Assert.NotNull(reservationType);

        var bookingSessionId = reservationType.FindProperty(nameof(Reservation.BookingSessionId));
        Assert.NotNull(bookingSessionId);
        Assert.True(bookingSessionId.IsNullable);

        var foreignKey = Assert.Single(
            reservationType.GetForeignKeys(),
            candidate => candidate.PrincipalEntityType.ClrType == typeof(BookingSession));
        Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior);
        Assert.Equal(nameof(BookingSession.Reservations), foreignKey.PrincipalToDependent?.Name);

        var index = Assert.Single(
            reservationType.GetIndexes(),
            candidate => candidate.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(Reservation.BookingSessionId)]));
        Assert.False(index.IsUnique);
    }

    [Fact]
    public void BookingSession_ReferencesOneClientGuestAndPropertyWithoutCascadeDeletes()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(BookingSession));
        Assert.NotNull(entityType);

        AssertForeignKey(entityType, nameof(BookingSession.ClientId), typeof(User), isRequired: true);
        AssertForeignKey(entityType, nameof(BookingSession.GuestId), typeof(Guest), isRequired: false);
        AssertForeignKey(entityType, nameof(BookingSession.PropertyId), typeof(Property), isRequired: true);
    }

    private static void AssertForeignKey(
        IReadOnlyEntityType entityType,
        string propertyName,
        Type principalType,
        bool isRequired)
    {
        var foreignKey = Assert.Single(
            entityType.GetForeignKeys(),
            candidate => candidate.Properties.Select(property => property.Name).SequenceEqual([propertyName]));

        Assert.Equal(principalType, foreignKey.PrincipalEntityType.ClrType);
        Assert.Equal(isRequired, foreignKey.IsRequired);
        Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior);
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
    }
}
