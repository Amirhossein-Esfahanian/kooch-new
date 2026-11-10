using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReviewPublicationReplyTests
{
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => DateTimeOffset.Parse("2026-11-08T10:00:00Z"); }
    private static GuestReviewService Service(KoochDbContext db) => new(db, new Clock(), propertyAuthorization: new PropertyAccessService(db));
    private static GuestReviewRequest Scores(int score = 1, int? revision = null) => new() {
        CleanlinessRating = score, StaffRating = score, ComfortRating = score, FacilitiesRating = score,
        LocationRating = score, ValueRating = score, Revision = revision };
    private static KoochDbContext Memory() => new(new DbContextOptionsBuilder<KoochDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    private static async Task<int> Seed(KoochDbContext db, bool baseSeed = true)
    {
        if (baseSeed) await GuestReviewTests.Seed(db);
        var property = await db.Properties.SingleAsync(); property.Slug = "stay"; property.OwnerId = 2;
        (await db.Users.SingleAsync(u => u.Id == 1)).Role = UserRole.Client;
        (await db.Users.SingleAsync(u => u.Id == 2)).Role = UserRole.Owner;
        db.Users.Add(new User { Id = 3, Role = UserRole.SuperAdmin, FirstName = "Moderator", IsActive = true });
        db.UserPropertyAccesses.Add(new UserPropertyAccess { UserId = 2, PropertyId = 1, PropertyRole = PropertyUserRole.PropertyOwner,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto { ["Reviews"] = new() { View = true, Edit = true } }) });
        await db.SaveChangesAsync();
        var review = await Service(db).SaveAsync(1, 1, Scores(), false);
        await Service(db).ModerateAsync(3, review.Id, new() { Revision = 1 }, true);
        return review.Id;
    }

    [Fact]
    public async Task RelationalPublicPipeline_ReplyVersions_UnpublicationAndRepublicationKeepHistory()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        await using var db = fixture.Context(); var id = await Seed(db, false); var service = Service(db);
        var publicBefore = await service.GetPublicReviewsAsync("stay");
        Assert.Equal(1, publicBefore.Summary.Count); Assert.Equal(1m, publicBefore.Summary.OverallRating);
        Assert.Null(Assert.Single(publicBefore.Reviews.Items).OwnerReply);
        var reply = await service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "First official response" });
        Assert.Equal(ReviewModerationStatus.PendingApproval, reply.ModerationStatus);
        Assert.Null(Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items).OwnerReply);
        await service.ModerateReplyAsync(3, reply.Id, new() { Revision = 1 }, true);
        var published = Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items);
        Assert.Equal("First official response", published.OwnerReply!.Text);
        await service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Edited official response", Revision = 2 });
        Assert.Equal("First official response", Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items).OwnerReply!.Text);
        await service.ModerateReplyAsync(3, reply.Id, new() { Revision = 3, RejectionReason = "Remove personal information." }, false);
        var rejected = Assert.Single((await service.ListOwnerReviewsAsync(2, 1)).Items).Reply!;
        Assert.Equal("Remove personal information.", rejected.RejectionReason);
        Assert.Equal("First official response", Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items).OwnerReply!.Text);
        await service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Corrected official response", Revision = 4 });
        var pending = Assert.Single((await service.ListRepliesForModerationAsync(3, new() { Status = ReviewModerationStatus.PendingApproval })).Items);
        Assert.Equal(5, pending.Reply.Revision); Assert.Null(pending.Reply.RejectionReason);
        await service.ModerateReplyAsync(3, reply.Id, new() { Revision = 5 }, true);
        Assert.Equal("Corrected official response", Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items).OwnerReply!.Text);
        var unpublished = await service.SetPublicationAsync(3, id, new() { Revision = 2, Reason = "Internal publication review" }, false);
        Assert.Equal(ReviewModerationStatus.Approved, unpublished.Review.ModerationStatus); Assert.False(unpublished.Review.IsPublished);
        Assert.Equal("Internal publication review", unpublished.UnpublicationReason);
        var empty = await service.GetPublicReviewsAsync("stay"); Assert.Equal(0, empty.Summary.Count); Assert.Null(empty.Summary.OverallRating); Assert.Empty(empty.Reviews.Items);
        Assert.Empty((await service.ListOwnerReviewsAsync(2, 1)).Items);
        Assert.Empty((await service.ListRepliesForModerationAsync(3, new())).Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Hidden response", Revision = 6 }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveAsync(1, 1, Scores(), false));
        Assert.DoesNotContain("UnpublicationReason", JsonSerializer.Serialize(await service.GetAsync(1, 1)));
        await service.SetPublicationAsync(3, id, new() { Revision = 3 }, true);
        Assert.Equal(1, (await service.GetPublicReviewsAsync("stay")).Summary.Count);
        Assert.Equal("Corrected official response", Assert.Single((await service.GetPublicReviewsAsync("stay")).Reviews.Items).OwnerReply!.Text);
        Assert.Single(db.Reviews); Assert.Single(db.ReviewOwnerReplies);
        Assert.Equal(2, await db.AuditLogs.CountAsync(a => a.Action == AuditAction.ReviewReplyApproved));
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewUnpublished).ToListAsync());
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewRepublished).ToListAsync());
    }

    [Fact]
    public async Task RelationalAggregatesUseExactSums_IncludeRatingOnlyAndServerSidePagination()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create(); await using var db = fixture.Context();
        await Seed(db, false);
        db.Reservations.Add(new Reservation { Id = 2, ClientId = 1, PropertyId = 1, RoomTypeId = 1, ReservationNumber = "REVIEW-2",
            Status = ReservationStatus.Completed, CheckInDate = new(2026, 11, 5), CheckOutDate = new(2026, 11, 7) }); await db.SaveChangesAsync();
        var scores = Scores(2); scores.ValueRating = 3;
        var second = await Service(db).SaveAsync(1, 2, scores, false); await Service(db).ModerateAsync(3, second.Id, new() { Revision = 1 }, true);
        var result = await Service(db).GetPublicReviewsAsync("stay", 1, 1);
        Assert.Equal(2, result.Summary.Count); Assert.Equal(19m / 12m, result.Summary.OverallRating);
        Assert.Equal(1.5m, result.Summary.Categories.CleanlinessRating); Assert.Equal(1.5m, result.Summary.Categories.StaffRating);
        Assert.Equal(1.5m, result.Summary.Categories.ComfortRating); Assert.Equal(1.5m, result.Summary.Categories.FacilitiesRating);
        Assert.Equal(1.5m, result.Summary.Categories.LocationRating); Assert.Equal(2m, result.Summary.Categories.ValueRating);
        Assert.Single(result.Reviews.Items); Assert.Equal(2, result.Reviews.TotalPages); Assert.Empty(Assert.Single(result.Reviews.Items).Comment);
        Assert.Equal(13m / 6m, (await Service(db).GetPublicReviewsAsync("stay", 1, 100)).Reviews.Items.Single(r => r.Id == second.Id).OverallRating);
        Assert.Single((await Service(db).GetPublicReviewsAsync("stay", 2, 1)).Reviews.Items);
        var json = JsonSerializer.Serialize(result); Assert.DoesNotContain("ReservationId", json); Assert.DoesNotContain("ClientId", json); Assert.DoesNotContain("ModeratedBy", json);
    }

    [Theory]
    [InlineData("pending")] [InlineData("rejected")] [InlineData("deleted")] [InlineData("legacy")]
    [InlineData("bad-score")] [InlineData("bad-sum")] [InlineData("incomplete")]
    [InlineData("reservation-deleted")] [InlineData("property-mismatch")] [InlineData("author-deleted")]
    public async Task PublicListsAndAggregatesShareStrictVisibility(string kind)
    {
        await using var db = Memory(); await Seed(db); var review = await db.Reviews.SingleAsync();
        if (kind == "pending") { review.ModerationStatus = ReviewModerationStatus.PendingApproval; review.IsPublished = false; }
        if (kind == "rejected") { review.ModerationStatus = ReviewModerationStatus.Rejected; review.IsPublished = false; }
        if (kind == "deleted") review.IsDeleted = true;
        if (kind == "legacy") { review.RatingSum = null; review.ModerationStatus = null; }
        if (kind == "bad-score") review.CleanlinessRating = 11;
        if (kind == "bad-sum") review.RatingSum = 60;
        if (kind == "incomplete") review.ComfortRating = null;
        if (kind == "reservation-deleted") (await db.Reservations.SingleAsync()).IsDeleted = true;
        if (kind == "property-mismatch") (await db.Reservations.SingleAsync()).PropertyId = 999;
        if (kind == "author-deleted") (await db.Users.SingleAsync(u => u.Id == 1)).IsDeleted = true;
        await db.SaveChangesAsync(); var result = await Service(db).GetPublicReviewsAsync("stay");
        Assert.Equal(0, result.Summary.Count); Assert.Null(result.Summary.OverallRating); Assert.Null(result.Summary.Categories.CleanlinessRating); Assert.Empty(result.Reviews.Items);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task PublicReviewsRequireApprovedNotDeletedProperty(bool deleted)
    {
        await using var db = Memory(); await Seed(db); var property = await db.Properties.SingleAsync();
        if (deleted) property.IsDeleted = true; else property.Status = PropertyStatus.Suspended;
        await db.SaveChangesAsync(); await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetPublicReviewsAsync("stay"));
    }

    [Fact]
    public async Task PublicationRequiresSuperAdminReasonAndRevision_AndNeverFreesReservation()
    {
        await using var db = Memory(); var id = await Seed(db); var service = Service(db);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SetPublicationAsync(2, id, new() { Revision = 2, Reason = "Valid internal reason" }, false));
        foreach (var reason in new[] { "", "  ", "abc", "!!!!!" })
            await Assert.ThrowsAsync<ArgumentException>(() => service.SetPublicationAsync(3, id, new() { Revision = 2, Reason = reason }, false));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetPublicationAsync(3, id, new() { Revision = 1, Reason = "Valid internal reason" }, false));
        await service.SetPublicationAsync(3, id, new() { Revision = 2, Reason = "Valid internal reason" }, false);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetPublicationAsync(3, id, new() { Revision = 3, Reason = "Repeat internal reason" }, false));
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewUnpublished).ToListAsync());
        var row = await db.Reviews.SingleAsync(); Assert.False(row.IsDeleted); Assert.Equal(1, row.ReservationId); Assert.Equal(6, row.RatingSum); Assert.Equal("", row.Comment);
        Assert.False(Assert.Single((await service.ListAsync(1)).Items).CanEdit);
        await service.SetPublicationAsync(3, id, new() { Revision = 3 }, true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetPublicationAsync(3, id, new() { Revision = 4 }, true));
    }

    [Fact]
    public async Task OwnerAccessUsesSelectedPropertyMembershipAndReviewPermission_NotPropertyEditOrPlatformRole()
    {
        await using var db = Memory(); var id = await Seed(db); var service = Service(db);
        Assert.Single((await service.ListOwnerReviewsAsync(2, 1)).Items);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListOwnerReviewsAsync(1, 1));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListOwnerReviewsAsync(2, 999));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SaveOwnerReplyAsync(1, 1, id, new() { Body = "Unauthorized response" }));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ModerateReplyAsync(2, 1, new() { Revision = 1 }, true));
        var membership = await db.UserPropertyAccesses.SingleAsync();
        membership.PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto { ["Reviews"] = new() { View = true }, ["Properties"] = new() { View = true, Edit = true } }); await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Not permitted" }));
        membership.IsActive = false; await db.SaveChangesAsync(); await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ListOwnerReviewsAsync(2, 1));
        Assert.Empty(db.ReviewOwnerReplies);
    }

    [Fact]
    public async Task OwnerFiltersAndReplayDoNotCreateParallelRepliesOrChangeGuestReview()
    {
        await using var db = Memory(); var id = await Seed(db); var service = Service(db);
        Assert.Single((await service.ListOwnerReviewsAsync(2, 1, "Unanswered")).Items);
        var reply = await service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Official reply" });
        var replay = await service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Official reply" }); Assert.Equal(reply, replay);
        Assert.Single((await service.ListOwnerReviewsAsync(2, 1, "PendingApproval")).Items);
        Assert.Empty((await service.ListOwnerReviewsAsync(2, 1, "Unanswered")).Items);
        Assert.Empty((await service.ListOwnerReviewsAsync(2, 1, "Answered")).Items);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveOwnerReplyAsync(2, 1, id, new() { Body = "Different creation" }));
        await service.ModerateReplyAsync(3, reply.Id, new() { Revision = 1 }, true);
        Assert.Single((await service.ListOwnerReviewsAsync(2, 1, "Answered")).Items);
        var draft = await service.SaveOwnerReplyAsync(2, 1, id, new() { Revision = 2, Body = "Replacement reply" });
        var editReplay = await service.SaveOwnerReplyAsync(2, 1, id, new() { Revision = 2, Body = "Replacement reply" }); Assert.Equal(draft, editReplay);
        Assert.Single(db.ReviewOwnerReplies); Assert.Equal(6, (await db.Reviews.SingleAsync()).RatingSum);
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewReplySubmitted).ToListAsync());
        Assert.Single(await db.AuditLogs.Where(a => a.Action == AuditAction.ReviewReplyEdited).ToListAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ModerateReplyAsync(3, reply.Id, new() { Revision = 2 }, true));
        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveOwnerReplyAsync(2, 1, id, new() { Revision = 3, Body = new string('x', 2001) }));
    }

    [Fact]
    public async Task ConcurrentReplyCreationAndModerationHaveUniqueWinnerAndAudits()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        int id; await using (var db = fixture.Context()) id = await Seed(db, false);
        async Task<bool> Write(bool moderate, string body)
        {
            await using var db = fixture.Context();
            try { if (moderate) await Service(db).ModerateReplyAsync(3, (await db.ReviewOwnerReplies.SingleAsync()).Id, new() { Revision = 1 }, true);
                else await Service(db).SaveOwnerReplyAsync(2, 1, id, new() { Body = body }); return true; }
            catch (InvalidOperationException) { return false; } catch (DbUpdateException) { return false; } catch (Microsoft.Data.Sqlite.SqliteException) { return false; }
        }
        var create = await Task.WhenAll(Task.Run(() => Write(false, "Official first reply")), Task.Run(() => Write(false, "Competing reply")));
        Assert.Contains(true, create);
        var moderate = await Task.WhenAll(Task.Run(() => Write(true, "")), Task.Run(() => Write(true, "")));
        Assert.Single(moderate, success => success);
        await using var verify = fixture.Context(); Assert.Single(await verify.ReviewOwnerReplies.ToListAsync());
        Assert.Single(await verify.AuditLogs.Where(a => a.Action == AuditAction.ReviewReplySubmitted).ToListAsync());
        Assert.Single(await verify.AuditLogs.Where(a => a.Action == AuditAction.ReviewReplyApproved).ToListAsync());
    }

    [Fact]
    public async Task FailedPublicationOrReplyAuditRollsBackState()
    {
        await using var fixture = await GuestReviewPersistenceTests.Database.Create();
        int id; int replyId; await using (var seed = fixture.Context()) { id = await Seed(seed, false); replyId = (await Service(seed).SaveOwnerReplyAsync(2, 1, id, new() { Body = "Official reply" })).Id; }
        await using (var db = fixture.Context(new FailAudit())) await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SetPublicationAsync(3, id, new() { Revision = 2, Reason = "Internal reason" }, false));
        await using (var db = fixture.Context(new FailAudit())) await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).ModerateReplyAsync(3, replyId, new() { Revision = 1 }, true));
        await using var verify = fixture.Context(); Assert.True((await verify.Reviews.SingleAsync()).IsPublished); Assert.Null((await verify.ReviewOwnerReplies.SingleAsync()).PublishedBody);
    }
    private sealed class FailAudit : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
        { if (data.Context!.ChangeTracker.Entries<AuditLog>().Any(e => e.State == EntityState.Added)) throw new InvalidOperationException("Isolated audit failure"); return ValueTask.FromResult(result); }
    }

    [Fact]
    public void AdditiveMigrationPreservesOldRecordsAndEnforcesOneOfficialResponse()
    {
        var migration = new AddReviewPublicationAndOwnerReplies { ActiveProvider = "Microsoft.EntityFrameworkCore.SqlServer" };
        Assert.Equal("UnpublicationReason", Assert.Single(migration.UpOperations.OfType<AddColumnOperation>()).Name);
        Assert.True(Assert.Single(migration.UpOperations.OfType<AddColumnOperation>()).IsNullable);
        var table = Assert.Single(migration.UpOperations.OfType<CreateTableOperation>()); Assert.Equal("ReviewOwnerReplies", table.Name);
        Assert.All(table.ForeignKeys, fk => Assert.Equal(Microsoft.EntityFrameworkCore.Migrations.ReferentialAction.NoAction, fk.OnDelete));
        Assert.Equal(new[] { "ReviewId" }, Assert.Single(migration.UpOperations.OfType<CreateIndexOperation>(), i => i.IsUnique).Columns);
        Assert.Empty(migration.UpOperations.OfType<DropColumnOperation>()); Assert.Empty(migration.UpOperations.OfType<SqlOperation>());
    }
}
