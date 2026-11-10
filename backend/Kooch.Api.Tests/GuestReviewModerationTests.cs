using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Kooch.Api.Migrations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReviewModerationTests
{
    private sealed class Clock : TimeProvider
    { public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-11-08T10:00:00Z"); }
    private static GuestReviewService Service(KoochDbContext db) => new(db, new Clock());
    private static GuestReviewRequest Scores(int value = 1, int? revision = null) => new()
    { CleanlinessRating = value, StaffRating = value, ComfortRating = value, FacilitiesRating = value,
        LocationRating = value, ValueRating = value, Revision = revision };
    private static KoochDbContext Memory() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    private static async Task<int> Seed(KoochDbContext db, bool baseSeed = true)
    {
        if (baseSeed) await GuestReviewTests.Seed(db);
        db.Users.AddRange(new User { Id = 3, Role = UserRole.SuperAdmin, FirstName = "Moderator", IsActive = true },
            new User { Id = 4, Role = UserRole.SuperAdmin, FirstName = "Second", IsActive = true });
        await db.SaveChangesAsync();
        return (await Service(db).SaveAsync(1, 1, Scores(), false)).Id;
    }

    [Theory]
    [InlineData(UserRole.Client)] [InlineData(UserRole.Owner)]
    [InlineData(UserRole.OwnerAssistant)] [InlineData(UserRole.AdminAssistant)]
    public async Task OnlyActiveSuperAdminMayReadOrDecide_EvenWithManageReviews(UserRole role)
    {
        await using var db = Memory(); var id = await Seed(db);
        var actor = await db.Users.SingleAsync(u => u.Id == 2); actor.Role = role;
        db.UserPermissions.Add(new UserPermission { UserId = 2, PermissionKey = PermissionKey.ManageReviews, IsAllowed = true });
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).ListForModerationAsync(2, new()));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).GetForModerationAsync(2, id));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).ModerateAsync(2, id, new() { Revision = 1 }, true));
        Assert.False((await db.Reviews.SingleAsync()).IsPublished);
    }

    [Theory]
    [InlineData("inactive")] [InlineData("deleted")] [InlineData("missing")]
    public async Task MissingInactiveAndDeletedModeratorsAreDenied(string kind)
    {
        await using var db = Memory(); var id = await Seed(db);
        var user = await db.Users.SingleAsync(u => u.Id == 3);
        if (kind == "inactive") user.IsActive = false;
        if (kind == "deleted") user.IsDeleted = true;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).ModerateAsync(kind == "missing" ? 999 : 3, id, new() { Revision = 1 }, true));
    }

    [Fact]
    public void ControllerRequiresBothSuperAdminPolicyAndEstablishedReviewPermission()
    {
        var type = typeof(AdminReviewsController);
        Assert.Single(type.GetCustomAttributes(typeof(SuperAdminAuthorizeAttribute), true));
        Assert.Equal("Permission:ManageReviews", Assert.IsType<PermissionAuthorizeAttribute>(
            Assert.Single(type.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true))).Policy);
    }

    [Fact]
    public void ModerationMigrationOnlyAddsNullableDecisionFieldsAndNonCascadingModeratorReference()
    {
        var migration = new AddGuestReviewModeration { ActiveProvider = "Microsoft.EntityFrameworkCore.SqlServer" };
        var columns = migration.UpOperations.OfType<AddColumnOperation>().ToList();
        Assert.Equal(3, columns.Count);
        Assert.All(columns, column => { Assert.Equal("Reviews", column.Table); Assert.True(column.IsNullable); });
        Assert.Equal(1000, columns.Single(column => column.Name == "RejectionReason").MaxLength);
        Assert.Empty(migration.UpOperations.OfType<SqlOperation>());
        Assert.Empty(migration.UpOperations.OfType<AlterColumnOperation>());
        Assert.Empty(migration.UpOperations.OfType<DropColumnOperation>());
        Assert.Equal(Microsoft.EntityFrameworkCore.Migrations.ReferentialAction.NoAction,
            Assert.Single(migration.UpOperations.OfType<AddForeignKeyOperation>()).OnDelete);
    }

    [Fact]
    public async Task ListsAreNewestFirst_BoundedFilteredAndExcludeLegacyAndDeleted()
    {
        await using var db = Memory(); var id = await Seed(db);
        db.Reservations.Add(new Reservation { Id = 2, ClientId = 1, PropertyId = 1, RoomTypeId = 1,
            ReservationNumber = "REVIEW-2", Status = ReservationStatus.Completed,
            CheckInDate = new DateOnly(2026, 11, 5), CheckOutDate = new DateOnly(2026, 11, 7) });
        await db.SaveChangesAsync(); var second = await Service(db).SaveAsync(1, 2, Scores(9), false);
        (await db.Reviews.SingleAsync(v => v.Id == id)).CreatedAtUtc = new DateTime(2026, 11, 7);
        (await db.Reviews.SingleAsync(v => v.Id == second.Id)).CreatedAtUtc = new DateTime(2026, 11, 8);
        db.Reviews.Add(new Review { ClientId = 1, PropertyId = 1, Rating = 4, IsPublished = true }); await db.SaveChangesAsync();
        var query = new AdminReviewQuery { Status = ReviewModerationStatus.PendingApproval, PageSize = 1, PropertyId = 1, Search = "Stay" };
        var first = await Service(db).ListForModerationAsync(3, query);
        Assert.Equal(2, first.TotalCount); Assert.Equal(2, first.TotalPages); Assert.Equal(second.Id, Assert.Single(first.Items).Review.Id);
        query.Page = 2; Assert.Equal(id, Assert.Single((await Service(db).ListForModerationAsync(3, query)).Items).Review.Id);
        query.Search = "REVIEW-1"; query.Page = 1; Assert.Single((await Service(db).ListForModerationAsync(3, query)).Items);
        query.PropertyId = 999; Assert.Empty((await Service(db).ListForModerationAsync(3, query)).Items);
        await Service(db).ModerateAsync(3, id, new() { Revision = 1 }, true);
        Assert.Equal(new[] { second.Id, id }, (await Service(db).ListForModerationAsync(3, new())).Items.Select(v => v.Review.Id));
        (await db.Reviews.SingleAsync(v => v.Id == id)).CreatedAtUtc = new DateTime(2026, 11, 8);
        await db.SaveChangesAsync();
        Assert.Equal(new[] { second.Id, id }, (await Service(db).ListForModerationAsync(3, new())).Items.Select(v => v.Review.Id));
        Assert.Single((await Service(db).ListForModerationAsync(3, new() { Status = ReviewModerationStatus.Approved })).Items);
        Assert.Empty((await Service(db).ListForModerationAsync(3, new() { Status = ReviewModerationStatus.Rejected })).Items);
        (await db.Reviews.SingleAsync(v => v.Id == second.Id)).IsDeleted = true; await db.SaveChangesAsync();
        Assert.Single((await Service(db).ListForModerationAsync(3, new())).Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetForModerationAsync(3, second.Id));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ListForModerationAsync(3, new() { Page = 0 }));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ListForModerationAsync(3, new() { PageSize = 101 }));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ListForModerationAsync(3, new() { Status = (ReviewModerationStatus)999 }));
    }

    [Theory]
    [InlineData(ReviewModerationStatus.PendingApproval)]
    [InlineData(ReviewModerationStatus.Approved)]
    [InlineData(ReviewModerationStatus.Rejected)]
    public async Task EveryStatusUsesSubmissionDescendingThenIdentityDescending(ReviewModerationStatus status)
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        await using var db = fixture.Context(); var id = await Seed(db, false);
        db.Reservations.Add(new Reservation { Id = 2, ClientId = 1, PropertyId = 1, RoomTypeId = 1,
            ReservationNumber = "REVIEW-2", Status = ReservationStatus.Completed,
            CheckInDate = new(2026, 11, 5), CheckOutDate = new(2026, 11, 7) });
        await db.SaveChangesAsync(); var second = await Service(db).SaveAsync(1, 2, Scores(), false);
        if (status != ReviewModerationStatus.PendingApproval)
            foreach (var reviewId in new[] { id, second.Id })
                await Service(db).ModerateAsync(3, reviewId, new() { Revision = 1, RejectionReason = "A meaningful reason" }, status == ReviewModerationStatus.Approved);
        // Set historical timestamps only in disposable SQLite; application timestamps are immutable.
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Reviews SET CreatedAtUtc = {new DateTime(2026, 11, 8)} WHERE Id = {id} OR Id = {second.Id}");
        var query = new AdminReviewQuery { Status = status, PageSize = 1 };
        Assert.Equal(second.Id, Assert.Single((await Service(db).ListForModerationAsync(3, query)).Items).Review.Id);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE Reviews SET CreatedAtUtc = {new DateTime(2026, 11, 9)} WHERE Id = {id}");
        Assert.Equal(id, Assert.Single((await Service(db).ListForModerationAsync(3, query)).Items).Review.Id);
        query.Page = 2;
        Assert.Equal(second.Id, Assert.Single((await Service(db).ListForModerationAsync(3, query)).Items).Review.Id);
    }

    [Fact]
    public async Task NegativeRatingOnlyReviewCanBeApproved_AndRepeatedDecisionsDoNotDuplicateAudit()
    {
        await using var db = Memory(); var id = await Seed(db);
        var result = await Service(db).ModerateAsync(3, id, new() { Revision = 1 }, true);
        Assert.Equal(1m, result.Review.OverallRating); Assert.Empty(result.Review.Comment);
        Assert.True(result.Review.IsPublished); Assert.Equal(ReviewModerationStatus.Approved, result.Review.ModerationStatus);
        Assert.Equal(2, result.Review.Revision); Assert.Equal(3, result.ModeratedByUserId);
        Assert.Equal(new Clock().GetUtcNow().UtcDateTime, result.ModeratedAtUtc);
        Assert.Null(result.Review.RejectionReason);
        var audit = await db.AuditLogs.SingleAsync(a => a.Action == AuditAction.ReviewApproved);
        Assert.Equal(id, audit.EntityId); Assert.Equal(3, audit.UserId);
        using var previous = JsonDocument.Parse(audit.PreviousValuesJson!);
        Assert.Equal(0, previous.RootElement.GetProperty("Review").GetProperty("ModerationStatus").GetInt32());
        Assert.Contains("\"Revision\":1", audit.PreviousValuesJson!);
        Assert.Contains("\"Revision\":2", audit.NewValuesJson!);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateAsync(4, id, new() { Revision = 1 }, true));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateAsync(4, id, new() { Revision = 2, RejectionReason = "A valid reason" }, false));
        Assert.Equal(2, await db.AuditLogs.CountAsync());
    }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("   ")] [InlineData("abc")] [InlineData("!!!!!!!")]
    public async Task RejectionRequiresMeaningfulReason_WithoutAnyDecisionWrites(string? reason)
    {
        await using var db = Memory(); var id = await Seed(db);
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ModerateAsync(3, id, new() { Revision = 1, RejectionReason = reason }, false));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).ModerateAsync(3, id, new() { Revision = 1, RejectionReason = new string('x', 1001) }, false));
        var review = await db.Reviews.SingleAsync(); Assert.Equal(1, review.Revision); Assert.False(review.IsPublished);
        Assert.Single(db.AuditLogs);
    }

    [Fact]
    public async Task RejectShowsOnlySafeReasonToOwner_AndResubmissionClearsActiveDecisionButRetainsAudit()
    {
        await using var db = Memory(); var id = await Seed(db);
        var rejected = await Service(db).ModerateAsync(3, id, new() { Revision = 1, RejectionReason = "  Please remove personal contact information.  " }, false);
        Assert.Equal(ReviewModerationStatus.Rejected, rejected.Review.ModerationStatus); Assert.False(rejected.Review.IsPublished);
        Assert.Equal("Please remove personal contact information.", rejected.Review.RejectionReason);
        Assert.Single((await Service(db).ListForModerationAsync(3, new() { Status = ReviewModerationStatus.Rejected })).Items);
        var owned = Assert.Single((await Service(db).ListAsync(1)).Items);
        Assert.True(owned.CanEdit); Assert.Equal(rejected.Review.RejectionReason, owned.Review.RejectionReason);
        Assert.Empty((await Service(db).ListAsync(2)).Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetAsync(2, 1));
        var json = JsonSerializer.Serialize(owned); Assert.DoesNotContain("ModeratedByUserId", json); Assert.DoesNotContain("ModeratedAtUtc", json);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateAsync(3, id, new() { Revision = 2 }, true));
        await Service(db).SaveAsync(1, 1, Scores(2, 2), true);
        var row = await db.Reviews.SingleAsync(); Assert.Null(row.RejectionReason); Assert.Null(row.ModeratedAtUtc); Assert.Null(row.ModeratedByUserId);
        Assert.False(row.IsPublished); Assert.Equal(ReviewModerationStatus.PendingApproval, row.ModerationStatus); Assert.Equal(3, row.Revision);
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewRejected).ToListAsync());
        await Service(db).ModerateAsync(4, id, new() { Revision = 3 }, true);
        Assert.Equal(4, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task GuestEditMakesAnAdminSnapshotStale()
    {
        await using var db = Memory(); var id = await Seed(db);
        await Service(db).SaveAsync(1, 1, Scores(5, 1), true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateAsync(3, id, new() { Revision = 1 }, true));
        Assert.False((await db.Reviews.SingleAsync()).IsPublished);
    }

    [Fact]
    public async Task RelationalConcurrentModeratorsPersistExactlyOneDecisionAndAudit()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        int id; await using (var seed = fixture.Context()) id = await Seed(seed, false);
        async Task<bool> Decide(int actor, bool approve)
        {
            await using var db = fixture.Context();
            try { await Service(db).ModerateAsync(actor, id, new() { Revision = 1, RejectionReason = "Remove personal information." }, approve); return true; }
            catch (InvalidOperationException) { return false; }
            catch (DbUpdateException) { return false; } // SQLite serializes concurrent writers differently from SQL Server.
            catch (Microsoft.Data.Sqlite.SqliteException) { return false; }
        }
        var results = await Task.WhenAll(Task.Run(() => Decide(3, true)), Task.Run(() => Decide(4, false)));
        Assert.Single(results, success => success);
        await using var verify = fixture.Context();
        var review = await verify.Reviews.SingleAsync(); Assert.Equal(2, review.Revision);
        Assert.Equal(review.ModerationStatus == ReviewModerationStatus.Approved, review.IsPublished);
        Assert.Single(await verify.AuditLogs.Where(a => a.Action == AuditAction.ReviewApproved || a.Action == AuditAction.ReviewRejected).ToListAsync());
    }

    [Fact]
    public async Task RelationalAuditFailureRollsBackDecision()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        int id; await using (var seed = fixture.Context()) id = await Seed(seed, false);
        await using (var db = fixture.Context(new FailModerationAudit()))
            await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateAsync(3, id, new() { Revision = 1 }, true));
        await using var verify = fixture.Context();
        var review = await verify.Reviews.SingleAsync(); Assert.Equal(1, review.Revision); Assert.False(review.IsPublished); Assert.Null(review.ModeratedAtUtc);
        Assert.Single(await verify.AuditLogs.ToListAsync());
    }

    private sealed class FailModerationAudit : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<AuditLog>().Any(e => e.Entity.Action == AuditAction.ReviewApproved))
                throw new InvalidOperationException("Isolated moderation audit failure");
            return ValueTask.FromResult(result);
        }
    }
}
