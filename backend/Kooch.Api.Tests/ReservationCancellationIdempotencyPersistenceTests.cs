using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationCancellationIdempotencyPersistenceTests
{
    private static readonly string Fingerprint = new('a', 64);

    [Fact]
    public void Migration_AddsOnlyNullableMetadataIndexAndPairConstraint()
    {
        var operations = new AddReservationCancellationIdempotency().UpOperations;
        var columns = operations.OfType<AddColumnOperation>().ToList();
        Assert.Equal(2, columns.Count);
        Assert.All(columns, column =>
        {
            Assert.Equal("Reservations", column.Table);
            Assert.True(column.IsNullable);
            Assert.Null(column.DefaultValue);
            Assert.Null(column.DefaultValueSql);
        });
        Assert.Equal(200, Assert.Single(columns, c => c.Name == "CancellationIdempotencyKey").MaxLength);
        Assert.Equal(64, Assert.Single(columns, c => c.Name == "CancellationRequestFingerprint").MaxLength);
        var index = Assert.Single(operations.OfType<CreateIndexOperation>());
        Assert.Equal("Reservations", index.Table);
        Assert.Equal(new[] { "CancellationIdempotencyKey" }, index.Columns);
        Assert.True(index.IsUnique);
        Assert.Equal("[CancellationIdempotencyKey] IS NOT NULL", index.Filter);
        var check = Assert.Single(operations.OfType<AddCheckConstraintOperation>());
        Assert.Equal("CK_Reservations_CancellationIdempotencyPair", check.Name);
        Assert.All(operations, operation => Assert.True(operation is
            AddColumnOperation or CreateIndexOperation or AddCheckConstraintOperation));
    }

    [Fact]
    public async Task LegacyNullPairRemainsValidAndUnrelatedReservationUpdatesStillSave()
    {
        using var database = new Database();
        var reservation = NewReservation(1);
        database.Context.Reservations.Add(reservation);
        await database.Context.SaveChangesAsync();
        reservation.GuestNote = "Updated while pending";
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        var saved = await database.Context.Reservations.SingleAsync();
        Assert.Null(saved.CancellationIdempotencyKey);
        Assert.Null(saved.CancellationRequestFingerprint);
        Assert.Equal("Updated while pending", saved.GuestNote);
    }

    [Fact]
    public async Task FirstCancellationTransitionPersistsKeyAndFingerprintTogether()
    {
        using var database = new Database();
        var reservation = NewReservation(1);
        database.Context.Reservations.Add(reservation);
        await database.Context.SaveChangesAsync();
        reservation.Status = ReservationStatus.Cancelled;
        reservation.CancellationIdempotencyKey = "cancel-1";
        reservation.CancellationRequestFingerprint = Fingerprint;
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        var saved = await database.Context.Reservations.SingleAsync();
        Assert.Equal(ReservationStatus.Cancelled, saved.Status);
        Assert.Equal("cancel-1", saved.CancellationIdempotencyKey);
        Assert.Equal(Fingerprint, saved.CancellationRequestFingerprint);
    }

    [Fact]
    public async Task DuplicateNonNullKeyIsRejectedByUniqueIndex()
    {
        using var database = new Database();
        database.Context.Reservations.AddRange(
            NewReservation(1, "same-key", Fingerprint),
            NewReservation(2, "same-key", new string('b', 64)));
        await Assert.ThrowsAsync<DbUpdateException>(() => database.Context.SaveChangesAsync());
    }

    [Theory]
    [InlineData("key-only")]
    [InlineData("fingerprint-only")]
    public async Task IncompletePairIsRejectedByModelAndDatabase(string caseName)
    {
        using var database = new Database();
        var reservation = caseName == "key-only"
            ? NewReservation(1, "key", null) : NewReservation(1, null, Fingerprint);
        database.Context.Reservations.Add(reservation);
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
        database.Context.ChangeTracker.Clear();
        database.Context.Reservations.Add(NewReservation(1));
        await database.Context.SaveChangesAsync();
        if (caseName == "key-only")
            await Assert.ThrowsAsync<SqliteException>(() => database.Context.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE Reservations SET CancellationIdempotencyKey = {"key"} WHERE Id = 1"));
        else
            await Assert.ThrowsAsync<SqliteException>(() => database.Context.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE Reservations SET CancellationRequestFingerprint = {Fingerprint} WHERE Id = 1"));
    }

    [Theory]
    [InlineData("key")]
    [InlineData("fingerprint")]
    [InlineData("both-cleared")]
    [InlineData("key-cleared")]
    [InlineData("fingerprint-cleared")]
    public async Task PersistedCancellationMetadataCannotChangeOrBeCleared(string change)
    {
        using var database = new Database();
        database.Context.Reservations.Add(NewReservation(1, "cancel-1", Fingerprint));
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        var reservation = await database.Context.Reservations.SingleAsync();
        switch (change)
        {
            case "key": reservation.CancellationIdempotencyKey = "cancel-2"; break;
            case "fingerprint": reservation.CancellationRequestFingerprint = new string('b', 64); break;
            case "both-cleared":
                reservation.CancellationIdempotencyKey = null;
                reservation.CancellationRequestFingerprint = null;
                break;
            case "key-cleared": reservation.CancellationIdempotencyKey = null; break;
            default: reservation.CancellationRequestFingerprint = null; break;
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
        database.Context.ChangeTracker.Clear();
        var saved = await database.Context.Reservations.SingleAsync();
        Assert.Equal("cancel-1", saved.CancellationIdempotencyKey);
        Assert.Equal(Fingerprint, saved.CancellationRequestFingerprint);
    }

    [Fact]
    public async Task LegacyCancelledReservationCannotAcquireFabricatedRequestMetadata()
    {
        using var database = new Database();
        database.Context.Reservations.Add(NewReservation(1, status: ReservationStatus.Cancelled));
        await database.Context.SaveChangesAsync();
        database.Context.ChangeTracker.Clear();
        var reservation = await database.Context.Reservations.SingleAsync();
        reservation.CancellationIdempotencyKey = "fabricated";
        reservation.CancellationRequestFingerprint = Fingerprint;
        await Assert.ThrowsAsync<InvalidOperationException>(() => database.Context.SaveChangesAsync());
    }

    [Fact]
    public void SqlServerModelKeepsOptionalLengthsAndFilteredUniqueIndex()
    {
        using var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=metadata_only;Integrated Security=True;TrustServerCertificate=True").Options);
        var entity = context.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Reservation))!;
        Assert.True(entity.FindProperty(nameof(Reservation.CancellationIdempotencyKey))!.IsNullable);
        Assert.Equal(200, entity.FindProperty(nameof(Reservation.CancellationIdempotencyKey))!.GetMaxLength());
        Assert.Equal(64, entity.FindProperty(nameof(Reservation.CancellationRequestFingerprint))!.GetMaxLength());
        var index = Assert.Single(entity.GetIndexes(), i => i.Properties.Count == 1 &&
            i.Properties[0].Name == nameof(Reservation.CancellationIdempotencyKey));
        Assert.True(index.IsUnique);
        Assert.Equal("[CancellationIdempotencyKey] IS NOT NULL", index.GetFilter());
        Assert.Single(entity.GetCheckConstraints(), c => c.Name == "CK_Reservations_CancellationIdempotencyPair");
    }

    private static Reservation NewReservation(int id, string? key = null, string? fingerprint = null,
        ReservationStatus status = ReservationStatus.Pending) => new()
    {
        Id = id, PropertyId = 1, ClientId = 1, RoomTypeId = 1,
        ReservationNumber = $"R-{100000 + id}", Status = key is null ? status : ReservationStatus.Cancelled,
        CancellationIdempotencyKey = key, CancellationRequestFingerprint = fingerprint
    };

    private sealed class Database : IDisposable
    {
        private readonly SqliteConnection connection = new("Data Source=:memory:;Foreign Keys=False");
        public KoochDbContext Context { get; }

        public Database()
        {
            connection.Open();
            Context = new TestContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
            Context.Database.EnsureCreated();
        }

        public void Dispose() { Context.Dispose(); connection.Dispose(); }
    }

    private sealed class TestContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<Reservation>().Property(reservation => reservation.RowVersion).ValueGeneratedNever();
        }
    }
}
