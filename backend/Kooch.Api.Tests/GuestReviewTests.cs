using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class GuestReviewTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-08T10:00:00Z");
    private sealed class Clock(DateTimeOffset now) : TimeProvider
    { public override DateTimeOffset GetUtcNow() => now; }
    private static GuestReviewRequest Scores(int score = 8) => new()
    {
        CleanlinessRating = score, StaffRating = score, ComfortRating = score,
        FacilitiesRating = score, LocationRating = score, ValueRating = score
    };
    private static KoochDbContext Memory() => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
    internal static async Task Seed(KoochDbContext db)
    {
        db.Users.AddRange(new User { Id = 1, FirstName = "Booker", IsActive = true },
            new User { Id = 2, FirstName = "Other", IsActive = true });
        db.Properties.Add(new Property { Id = 1, Name = "Stay", OwnerId = 1, DestinationId = 1,
            Country = "IR", CheckOutTime = new TimeOnly(12, 0), Status = PropertyStatus.Approved });
        db.Reservations.Add(new Reservation { Id = 1, ClientId = 1, PropertyId = 1, RoomTypeId = 1,
            ReservationNumber = "REVIEW-1", Status = ReservationStatus.Completed,
            CheckInDate = new DateOnly(2026, 11, 5), CheckOutDate = new DateOnly(2026, 11, 7) });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }
    private static GuestReviewService Service(KoochDbContext db, DateTimeOffset? now = null) => new(db, new Clock(now ?? Now));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("توضیح اختیاری")]
    public async Task CompletedStay_SavesExactScores_UnpublishedAndPending_WithAtomicAudit(string? comment)
    {
        await using var db = Memory(); await Seed(db);
        var request = Scores(1); request.ValueRating = 2; request.Comment = comment;
        var result = await Service(db).SaveAsync(1, 1, request, false);
        Assert.Equal(7, result.RatingSum);
        Assert.Equal(7m / 6m, result.OverallRating);
        Assert.Equal(ReviewModerationStatus.PendingApproval, result.ModerationStatus);
        Assert.False(result.IsPublished);
        Assert.Equal(comment ?? "", result.Comment);
        Assert.Equal(1, result.Revision);
        var audit = await db.AuditLogs.SingleAsync();
        Assert.Equal(1, audit.UserId);
        Assert.Equal(AuditAction.ReviewSubmitted, audit.Action);
        Assert.Null(audit.PreviousValuesJson);
        Assert.Contains("\"RatingSum\":7", audit.NewValuesJson);
        Assert.Equal(result, await Service(db).GetAsync(1, 1));
    }

    [Theory]
    [InlineData(ReservationStatus.Pending)] [InlineData(ReservationStatus.Paid)]
    [InlineData(ReservationStatus.Confirmed)] [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.Rejected)] [InlineData(ReservationStatus.PaymentExpired)]
    [InlineData(ReservationStatus.PendingApproval)] [InlineData(ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(ReservationStatus.Draft)] [InlineData(ReservationStatus.CapacityLost)]
    public async Task OnlyCompletedStatusIsEligible(ReservationStatus status)
    {
        await using var db = Memory(); await Seed(db);
        (await db.Reservations.SingleAsync()).Status = status; await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
        Assert.Empty(db.Reviews); Assert.Empty(db.AuditLogs);
    }

    [Theory]
    [InlineData("2026-11-07T08:29:59Z", false)] // Before local checkout time.
    [InlineData("2026-11-07T08:30:00Z", true)]
    [InlineData("2026-12-07T20:29:59Z", true)] // End of the thirtieth local day.
    [InlineData("2026-12-07T20:30:00Z", false)]
    public async Task WindowUsesTehranCheckoutTimeAndLocalMidnight(string utc, bool eligible)
    {
        await using var db = Memory(); await Seed(db);
        var service = Service(db, DateTimeOffset.Parse(utc));
        Assert.Equal(eligible ? 1 : 0, (await service.EligibleAsync(1)).TotalCount);
        if (eligible) await service.SaveAsync(1, 1, Scores(), false);
        else await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveAsync(1, 1, Scores(), false));
    }

    [Theory]
    [InlineData("deleted-reservation")] [InlineData("deleted-property")]
    [InlineData("cancelled-marker")] [InlineData("invalid-dates")]
    public async Task InvalidOrDeletedStayCannotBeReviewed(string reason)
    {
        await using var db = Memory(); await Seed(db);
        var r = await db.Reservations.SingleAsync();
        if (reason == "deleted-reservation") r.IsDeleted = true;
        if (reason == "deleted-property") (await db.Properties.SingleAsync()).IsDeleted = true;
        if (reason == "cancelled-marker") r.CancelledAtUtc = Now.UtcDateTime;
        if (reason == "invalid-dates") r.CheckInDate = r.CheckOutDate;
        await db.SaveChangesAsync();
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
        await Assert.ThrowsAnyAsync<Exception>(() => Service(db).SaveAsync(1, 1, Scores(), false));
        Assert.Empty(db.Reviews);
    }

    [Fact]
    public async Task FinalizedCancellationHistoryCannotMasqueradeAsCompletedStay()
    {
        await using var db = Memory(); await Seed(db);
        // Deliberately inconsistent historical fixture; no financial operation is executed.
        db.CancellationFinancialResolutions.Add(new CancellationFinancialResolution { ReservationId = 1, Currency = "IRR" });
        await db.SaveChangesAsync();
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
    }

    [Fact]
    public async Task AmbiguousCompletedStayWithLegacyRefundFailsClosedWithoutChangingFinancialHistory()
    {
        await using var db = Memory(); await Seed(db);
        db.RefundRecords.Add(new RefundRecord { ReservationId = 1, PropertyId = 1, PaymentId = 1,
            Amount = 100, Currency = "IRR", Reason = "Isolated historical fixture", ReferenceNumber = "fixture" });
        await db.SaveChangesAsync();
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
        Assert.Equal(ReservationStatus.Completed, (await db.Reservations.SingleAsync()).Status);
        Assert.Single(db.RefundRecords);
        Assert.Empty(db.Reviews);
    }

    [Fact]
    public async Task OwnershipAndActiveAccountAreRequired_WithNoPrivilegedRoleBypass()
    {
        await using var db = Memory(); await Seed(db);
        (await db.Users.SingleAsync(u => u.Id == 2)).Role = UserRole.SuperAdmin; await db.SaveChangesAsync();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).SaveAsync(2, 1, Scores(), false));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetAsync(2, 1));
        Assert.Empty((await Service(db).EligibleAsync(2)).Items);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).SaveAsync(0, 1, Scores(), false));
        (await db.Users.SingleAsync(u => u.Id == 1)).IsActive = false; await db.SaveChangesAsync();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
    }

    [Fact]
    public async Task LinkedGuestMaySubmitButCannotTakeOverAnotherAuthorsReview()
    {
        await using var db = Memory(); await Seed(db);
        db.Guests.Add(new Guest { Id = 1, UserId = 2 });
        (await db.Reservations.SingleAsync()).GuestId = 1; await db.SaveChangesAsync();
        var created = await Service(db).SaveAsync(2, 1, Scores(), false);
        Assert.Equal(2, (await db.Reviews.SingleAsync()).ClientId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
        var change = Scores(); change.Revision = created.Revision;
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).SaveAsync(1, 1, change, true));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).GetAsync(1, 1));
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
    }

    [Fact]
    public async Task DeletedGuestLinkDoesNotAuthorizeEligibilityThroughHistoricalSubqueries()
    {
        await using var db = Memory(); await Seed(db);
        db.Guests.Add(new Guest { Id = 1, UserId = 2, IsDeleted = true });
        (await db.Reservations.SingleAsync()).GuestId = 1; await db.SaveChangesAsync();
        Assert.Empty((await Service(db).EligibleAsync(2)).Items);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Service(db).SaveAsync(2, 1, Scores(), false));
        Assert.Single((await Service(db).EligibleAsync(1)).Items);
    }

    [Theory]
    [InlineData(0)] [InlineData(11)]
    public async Task EveryCategoryIsRequiredAndValidatedAtServiceBoundary(int invalid)
    {
        await using var db = Memory(); await Seed(db);
        foreach (var property in typeof(GuestReviewRequest).GetProperties().Where(p => p.Name.EndsWith("Rating")))
        {
            var request = Scores(); property.SetValue(request, invalid);
            await Assert.ThrowsAsync<ArgumentException>(() => Service(db).SaveAsync(1, 1, request, false));
            Assert.False(Validator.TryValidateObject(request, new ValidationContext(request), [], true));
        }
        Assert.Empty(db.Reviews);
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<GuestReviewRequest>("{\"CleanlinessRating\":1.5}"));
    }

    [Fact]
    public async Task OversizedCommentAndMissingEditRevisionAreRejected()
    {
        await using var db = Memory(); await Seed(db);
        var r = Scores(); r.Comment = new string('a', 4001);
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).SaveAsync(1, 1, r, false));
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).SaveAsync(1, 1, Scores(), true));
    }

    [Theory]
    [InlineData(ReviewModerationStatus.PendingApproval)] [InlineData(ReviewModerationStatus.Rejected)]
    public async Task EditAndResubmitKeepHistory_ResetModeration_AndRejectStaleRevision(ReviewModerationStatus status)
    {
        await using var db = Memory(); await Seed(db);
        var created = await Service(db).SaveAsync(1, 1, Scores(9), false);
        var entity = await db.Reviews.SingleAsync(); entity.ModerationStatus = status; await db.SaveChangesAsync();
        var request = Scores(2); request.Revision = 1;
        var updated = await Service(db).SaveAsync(1, 1, request, true);
        Assert.Equal(created.Id, updated.Id);
        Assert.Equal(2, updated.Revision);
        Assert.Equal(ReviewModerationStatus.PendingApproval, updated.ModerationStatus);
        Assert.False(updated.IsPublished);
        Assert.Equal(2m, updated.OverallRating);
        var history = await db.AuditLogs.OrderBy(a => a.Id).ToListAsync();
        Assert.Equal(2, history.Count);
        Assert.Contains("\"RatingSum\":54", history[1].PreviousValuesJson);
        Assert.Contains("\"RatingSum\":12", history[1].NewValuesJson);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, request, true));
        Assert.Equal(2, await db.AuditLogs.CountAsync());
    }

    [Theory]
    [InlineData("approved")] [InlineData("deleted")] [InlineData("legacy")] [InlineData("property-mismatch")]
    public async Task ExistingReviewCannotBeReplacedOrUnsafeReviewEdited(string kind)
    {
        await using var db = Memory(); await Seed(db);
        await Service(db).SaveAsync(1, 1, Scores(), false);
        var review = await db.Reviews.SingleAsync();
        if (kind == "approved") { review.ModerationStatus = ReviewModerationStatus.Approved; review.IsPublished = true; }
        if (kind == "deleted") review.IsDeleted = true;
        if (kind == "legacy") { review.RatingSum = null; review.ModerationStatus = null; }
        if (kind == "property-mismatch") review.PropertyId = 999;
        await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveAsync(1, 1, Scores(), false));
        var request = Scores(); request.Revision = 1;
        await Assert.ThrowsAnyAsync<Exception>(() => Service(db).SaveAsync(1, 1, request, true));
        Assert.Empty((await Service(db).EligibleAsync(1)).Items);
        Assert.Single(db.Reviews.IgnoreQueryFilters());
    }

    [Fact]
    public async Task EligibilityIsBoundedAndDoesNotWrite()
    {
        await using var db = Memory(); await Seed(db);
        var result = await Service(db).EligibleAsync(1, 1, 1);
        Assert.Single(result.Items); Assert.Equal(1, result.TotalPages);
        Assert.Equal(new DateOnly(2026, 12, 7), result.Items[0].SubmissionDeadlineLocalDate);
        Assert.Empty(db.AuditLogs); Assert.Empty(db.Reviews);
        await Assert.ThrowsAsync<ArgumentException>(() => Service(db).EligibleAsync(1, 1, 101));
        Assert.NotNull(typeof(AccountReviewsController).GetCustomAttributes(typeof(AuthorizeAttribute), true).SingleOrDefault());
    }

    [Fact]
    public void ModelPreservesLegacyFields_AndHasFilteredUniquenessAndExactScoreChecks()
    {
        using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=unused;Database=unused;Integrated Security=true;TrustServerCertificate=true").Options);
        var model = db.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Review))!;
        Assert.True(model.GetIndexes().Single(i => i.Properties.Single().Name == nameof(Review.ReservationId)).IsUnique);
        Assert.True(model.FindProperty(nameof(Review.ReservationId))!.IsNullable);
        Assert.True(model.FindProperty(nameof(Review.RatingSum))!.IsNullable);
        Assert.Equal(typeof(int), model.FindProperty(nameof(Review.Rating))!.ClrType);
        Assert.True(model.FindProperty(nameof(Review.Revision))!.IsConcurrencyToken);
        Assert.Contains(model.GetCheckConstraints(), c => c.Name == "CK_Review_VerifiedScores" && c.Sql.Contains("[IsPublished] = 0 OR [ModerationStatus] = 1"));
        var script = db.Database.GenerateCreateScript();
        Assert.Contains("CREATE UNIQUE INDEX [IX_Reviews_ReservationId]", script);
        Assert.Contains("WHERE [ReservationId] IS NOT NULL", script);
    }
}
