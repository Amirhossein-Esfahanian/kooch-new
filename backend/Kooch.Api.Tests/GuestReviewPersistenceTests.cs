using Kooch.Api.Data;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReviewPersistenceTests
{
    private sealed class Clock : TimeProvider
    { public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-11-08T10:00:00Z"); }
    private static GuestReviewRequest Scores() => new()
    { CleanlinessRating = 8, StaffRating = 7, ComfortRating = 6, FacilitiesRating = 5, LocationRating = 9, ValueRating = 10 };

    [Fact]
    public async Task RelationalService_TranslatesEligibility_PersistsAllScoresAndAudit_AndReadsWithoutWrites()
    {
        await using var fixture = await Database.Create();
        await using var db = fixture.Context();
        var service = new GuestReviewService(db, new Clock());
        Assert.Single((await service.EligibleAsync(1)).Items);
        var result = await service.SaveAsync(1, 1, Scores(), false);
        Assert.Equal(45, result.RatingSum);
        Assert.Equal(7.5m, result.OverallRating);
        Assert.Equal(result, await service.GetAsync(1, 1));
        Assert.Single((await service.EligibleAsync(1)).Items); // Pending review can be edited.
        Assert.Single(await db.Reviews.ToListAsync());
        Assert.Single(await db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task TwoIndependentRequests_CannotCreateTwoReviewsOrTwoSubmissionAudits()
    {
        await using var fixture = await Database.Create();
        async Task<bool> Submit()
        {
            await using var db = fixture.Context();
            try { await new GuestReviewService(db, new Clock()).SaveAsync(1, 1, Scores(), false); return true; }
            catch (InvalidOperationException) { return false; }
            catch (DbUpdateException) { return false; } // SQLite reports competing write snapshots as busy/constraint errors.
        }
        var results = await Task.WhenAll(Task.Run(Submit), Task.Run(Submit));
        Assert.Single(results, success => success);
        await using var verify = fixture.Context();
        Assert.Equal(1, await verify.Reviews.CountAsync());
        Assert.Equal(1, await verify.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task DatabaseRejectsDuplicateReservationIncludingSoftDeletedReview()
    {
        await using var fixture = await Database.Create();
        await using (var db = fixture.Context())
        {
            await new GuestReviewService(db, new Clock()).SaveAsync(1, 1, Scores(), false);
            var first = await db.Reviews.SingleAsync(); first.IsDeleted = true; await db.SaveChangesAsync();
        }
        await using var other = fixture.Context();
        other.Reviews.Add(new Review { ReservationId = 1, ClientId = 2, PropertyId = 1 });
        await Assert.ThrowsAsync<DbUpdateException>(() => other.SaveChangesAsync());
    }

    [Fact]
    public async Task DatabaseRejectsIncompleteRatingsAndUnapprovedPublication_WhilePreservingLegacyRows()
    {
        await using var fixture = await Database.Create();
        await using (var db = fixture.Context())
        {
            db.Reviews.Add(new Review { ClientId = 1, PropertyId = 1, Rating = 4, CleanlinessRating = 5,
                IsPublished = true, Comment = "Historical" });
            await db.SaveChangesAsync();
            var legacy = await db.Reviews.SingleAsync();
            Assert.Null(legacy.RatingSum); Assert.Null(legacy.ModerationStatus); Assert.Null(legacy.ReservationId);
        }
        await using (var db = fixture.Context())
        {
            var saved = await new GuestReviewService(db, new Clock()).SaveAsync(1, 1, Scores(), false);
            var review = await db.Reviews.SingleAsync(r => r.Id == saved.Id);
            review.IsPublished = true;
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }
        await using (var db = fixture.Context())
        {
            var review = await db.Reviews.SingleAsync(r => r.ReservationId == 1);
            review.ComfortRating = null;
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }
    }

    [Fact]
    public async Task CompetingEditsUseRevisionTokenAndDoNotLoseTheWinningReview()
    {
        await using var fixture = await Database.Create();
        await using (var setup = fixture.Context()) await new GuestReviewService(setup, new Clock()).SaveAsync(1, 1, Scores(), false);
        await using var first = fixture.Context(); await using var second = fixture.Context();
        var a = await first.Reviews.SingleAsync(); var b = await second.Reviews.SingleAsync();
        a.Comment = "Winning revision"; a.Revision++;
        b.Comment = "Stale revision"; b.Revision++;
        await first.SaveChangesAsync();
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
    }

    [Fact]
    public async Task FailedAuditRollsBackReviewCreation()
    {
        await using var fixture = await Database.Create();
        await using var db = fixture.Context(new FailAudit());
        await Assert.ThrowsAsync<InvalidOperationException>(() => new GuestReviewService(db, new Clock()).SaveAsync(1, 1, Scores(), false));
        await using var verify = fixture.Context();
        Assert.Empty(await verify.Reviews.ToListAsync()); Assert.Empty(await verify.AuditLogs.ToListAsync());
    }

    [Fact]
    public void MigrationIsAdditiveAndStopsInsteadOfConvertingDuplicateHistory()
    {
        var migration = new AddVerifiedStayGuestReviews { ActiveProvider = "Microsoft.EntityFrameworkCore.SqlServer" };
        Assert.Equal(5, migration.UpOperations.OfType<AddColumnOperation>().Count());
        Assert.Empty(migration.UpOperations.OfType<DropColumnOperation>());
        Assert.Empty(migration.UpOperations.OfType<AlterColumnOperation>());
        Assert.Contains("THROW 51000", Assert.IsType<SqlOperation>(migration.UpOperations[0]).Sql);
        Assert.Contains("THROW 51001", Assert.IsType<SqlOperation>(migration.DownOperations[0]).Sql);
        var unique = Assert.Single(migration.UpOperations.OfType<CreateIndexOperation>());
        Assert.True(unique.IsUnique); Assert.Equal("[ReservationId] IS NOT NULL", unique.Filter);
    }

    private sealed class FailAudit : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<AuditLog>().Any()) throw new InvalidOperationException("Isolated audit failure");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Database : IAsyncDisposable
    {
        private readonly string path = Path.Combine(Path.GetTempPath(), $"kooch-review-test-{Guid.NewGuid():N}.db");
        public KoochDbContext Context(IInterceptor? interceptor = null)
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite($"Data Source={path};Pooling=False;Default Timeout=10");
            if (interceptor is not null) options.AddInterceptors(interceptor);
            return new KoochDbContext(options.Options);
        }
        public static async Task<Database> Create()
        {
            var fixture = new Database();
            await using var db = fixture.Context();
            // Only disposable test tables; mirror the actual mapped columns and Review constraints.
            // Other domain tables/SQL Server-only financial checks are deliberately outside this fixture.
            Type[] tables = [typeof(User), typeof(Property), typeof(Guest), typeof(Reservation), typeof(Review), typeof(AuditLog), typeof(CancellationFinancialResolution), typeof(RefundRecord)];
            var model = db.GetService<IDesignTimeModel>().Model;
            foreach (var type in tables)
            {
                var entity = model.FindEntityType(type)!;
                var columns = entity.GetProperties().Select(p =>
                {
                    if (p.Name == "Id") return "[Id] INTEGER PRIMARY KEY AUTOINCREMENT";
                    var clr = Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType;
                    var sqlType = clr == typeof(byte[]) ? "BLOB" : clr.IsEnum || clr == typeof(int) || clr == typeof(bool) || clr == typeof(long) ? "INTEGER" : "TEXT";
                    var defaultSql = p.Name == "RowVersion" ? " DEFAULT (randomblob(8))" :
                        clr == typeof(bool) ? $" DEFAULT {(p.GetDefaultValue() is true ? 1 : 0)}" :
                        clr == typeof(int) || clr.IsEnum ? $" DEFAULT {Convert.ToInt64(p.GetDefaultValue() ?? 0)}" : "";
                    return $"[{p.GetColumnName()}] {sqlType}" + defaultSql;
                }).ToList();
                if (type == typeof(Review)) columns.AddRange(entity.GetCheckConstraints().Select(c => $"CONSTRAINT [{c.Name}] CHECK ({c.Sql})"));
                // SQL identifiers/constraints originate solely from the trusted EF model, never request data.
                var createTable = $"CREATE TABLE [{entity.GetTableName()}] ({string.Join(",", columns)})";
                await db.Database.ExecuteSqlRawAsync(createTable);
            }
            await db.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX IX_Reviews_ReservationId ON Reviews(ReservationId) WHERE ReservationId IS NOT NULL");
            await GuestReviewTests.Seed(db);
            return fixture;
        }
        public ValueTask DisposeAsync() { File.Delete(path); return ValueTask.CompletedTask; }
    }
}
