using System.Data;
using System.Text.Json;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class GuestReviewService
{
    // Shared by public lists, aggregates and owner response commands. Never admit legacy ratings.
    private IQueryable<Review> PublishedReviews() => ModeratableReviews().Where(v =>
        v.ModerationStatus == ReviewModerationStatus.Approved && v.IsPublished && !v.Client.IsDeleted &&
        v.CleanlinessRating >= 1 && v.CleanlinessRating <= 10 && v.StaffRating >= 1 && v.StaffRating <= 10 &&
        v.ComfortRating >= 1 && v.ComfortRating <= 10 && v.FacilitiesRating >= 1 && v.FacilitiesRating <= 10 &&
        v.LocationRating >= 1 && v.LocationRating <= 10 && v.ValueRating >= 1 && v.ValueRating <= 10 &&
        v.RatingSum == v.CleanlinessRating + v.StaffRating + v.ComfortRating + v.FacilitiesRating + v.LocationRating + v.ValueRating);

    private IQueryable<Review> ReviewWriteLock(int id) => context.Database.IsSqlServer()
        ? context.Reviews.FromSqlInterpolated($"SELECT * FROM [Reviews] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}")
        : context.Reviews.Where(v => v.Id == id);

    private static void ValidatePage(int page, int pageSize)
    {
        if (page is < 1 or > 100000 || pageSize is < 1 or > 100) throw new ArgumentException("Invalid review pagination.");
    }
    private static bool MeaningfulReason(string? reason) => !string.IsNullOrWhiteSpace(reason) &&
        reason.Length is >= 5 and <= 1000 && reason.Any(char.IsLetterOrDigit);

    public async Task<AdminReviewResponse> SetPublicationAsync(int userId, int id, ReviewPublicationRequest request,
        bool publish, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct);
        var reason = request.Reason?.Trim();
        if (request.Revision < 1 || !publish && !MeaningfulReason(reason)) throw new ArgumentException("ReviewPublicationReasonRequired: provide a meaningful unpublication reason.");
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(ct) : null;
        var review = await ReviewWriteLock(id).SingleOrDefaultAsync(ct) ?? throw new KeyNotFoundException("Review not found.");
        if (review.Revision != request.Revision || review.ModerationStatus != ReviewModerationStatus.Approved ||
            review.IsPublished == publish || !await ModeratableReviews().AnyAsync(v => v.Id == id, ct))
            throw new InvalidOperationException("ReviewModerationConflict: reload the review before deciding.");
        var previous = DecisionSnapshot(review);
        review.IsPublished = publish;
        review.UnpublicationReason = publish ? null : reason;
        review.ModeratedByUserId = userId; review.ModeratedAtUtc = clock.GetUtcNow().UtcDateTime;
        review.UpdatedByUserId = userId; review.Revision = checked(review.Revision + 1);
        AddReviewAudit(userId, review.PropertyId, publish ? AuditAction.ReviewRepublished : AuditAction.ReviewUnpublished,
            nameof(Review), review.Id, previous, DecisionSnapshot(review));
        await SaveReviewChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return await GetForModerationAsync(userId, id, ct);
    }

    private void AddReviewAudit(int actor, int propertyId, AuditAction action, string entity, int id, object? previous, object next) =>
        context.AuditLogs.Add(new AuditLog { UserId = actor, PropertyId = propertyId, Action = action,
            EntityType = entity, EntityId = id, PreviousValuesJson = previous is null ? null : JsonSerializer.Serialize(previous),
            NewValuesJson = JsonSerializer.Serialize(next), OccurredAtUtc = clock.GetUtcNow().UtcDateTime });

    private async Task SaveReviewChangesAsync(CancellationToken ct)
    {
        try { await context.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new InvalidOperationException("ReviewModerationConflict: reload the current revision."); }
        catch (DbUpdateException e) when (e.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2601 or 2627 } sql &&
            sql.Message.Contains("IX_ReviewOwnerReplies_ReviewId", StringComparison.OrdinalIgnoreCase))
        { throw new InvalidOperationException("ReviewReplyConflict: one official reply already exists; reload it before editing."); }
    }

    private sealed record PublicReviewRow(int Id, string GuestDisplayName, DateTime SubmittedAtUtc,
        int CleanlinessRating, int StaffRating, int ComfortRating, int FacilitiesRating,
        int LocationRating, int ValueRating, int RatingSum, string Comment, PublicOwnerReply? OwnerReply,
        string? RoomTypeName, DateOnly? CheckInDate, DateOnly? CheckOutDate)
    {
        // Divide only after the bounded SQL projection, avoiding SQL decimal scale rounding.
        public PublicGuestReview Response() => new(Id, GuestDisplayName, SubmittedAtUtc, CleanlinessRating,
            StaffRating, ComfortRating, FacilitiesRating, LocationRating, ValueRating, RatingSum / 6m, Comment, OwnerReply)
            { RoomTypeName = RoomTypeName, CheckInDate = CheckInDate, CheckOutDate = CheckOutDate };
    }
    private IQueryable<PublicReviewRow> PublicProjection(IQueryable<Review> query, bool includeStayMetadata = false) => query.Select(v => new PublicReviewRow(
        v.Id, v.Client.FirstName == "" ? "مهمان" : v.Client.FirstName, v.CreatedAtUtc,
        v.CleanlinessRating!.Value, v.StaffRating!.Value, v.ComfortRating!.Value, v.FacilitiesRating!.Value,
        v.LocationRating!.Value, v.ValueRating!.Value, v.RatingSum!.Value, v.Comment,
        context.ReviewOwnerReplies.Where(r => r.ReviewId == v.Id && !r.IsDeleted && r.PublishedBody != null)
            .Select(r => new PublicOwnerReply(r.PublishedBody!, r.PublishedAtUtc)).FirstOrDefault(),
        includeStayMetadata && v.Reservation != null && !v.Reservation.IsDeleted && v.Reservation.PropertyId == v.PropertyId
            ? context.RoomTypes.Where(room => room.Id == v.Reservation.RoomTypeId && !room.IsDeleted && room.PropertyId == v.PropertyId)
                .Select(room => room.Name).FirstOrDefault() : null,
        includeStayMetadata && v.Reservation != null && !v.Reservation.IsDeleted && v.Reservation.PropertyId == v.PropertyId &&
            v.Reservation.CheckInDate > DateOnly.MinValue && v.Reservation.CheckOutDate > v.Reservation.CheckInDate
            ? v.Reservation.CheckInDate : (DateOnly?)null,
        includeStayMetadata && v.Reservation != null && !v.Reservation.IsDeleted && v.Reservation.PropertyId == v.PropertyId &&
            v.Reservation.CheckInDate > DateOnly.MinValue && v.Reservation.CheckOutDate > v.Reservation.CheckInDate
            ? v.Reservation.CheckOutDate : (DateOnly?)null));

    public async Task<PublicPropertyReviewsResponse> GetPublicReviewsAsync(string slug, int page = 1, int pageSize = 10, CancellationToken ct = default)
    {
        ValidatePage(page, pageSize);
        // Keep the aggregate and paginated items consistent with a concurrent unpublication.
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct) : null;
        var normalized = EnglishSlugGenerator.NormalizeLookup(slug);
        var propertyId = await context.Properties.AsNoTracking().Where(p => p.Status == PropertyStatus.Approved && p.Slug == normalized)
            .Select(p => (int?)p.Id).SingleOrDefaultAsync(ct) ?? throw new KeyNotFoundException("Property not found.");
        var query = PublishedReviews().AsNoTracking().Where(v => v.PropertyId == propertyId);
        var totals = await query.GroupBy(v => 1).Select(g => new {
            Count = g.Count(), Sum = g.Sum(v => (long)v.RatingSum!.Value),
            Cleanliness = g.Sum(v => (long)v.CleanlinessRating!.Value), Staff = g.Sum(v => (long)v.StaffRating!.Value),
            Comfort = g.Sum(v => (long)v.ComfortRating!.Value), Facilities = g.Sum(v => (long)v.FacilitiesRating!.Value),
            Location = g.Sum(v => (long)v.LocationRating!.Value), Value = g.Sum(v => (long)v.ValueRating!.Value)
        }).SingleOrDefaultAsync(ct);
        var count = totals?.Count ?? 0;
        var summary = count == 0 ? new PublicReviewSummary(0, null, new(null, null, null, null, null, null))
            : new PublicReviewSummary(count, totals!.Sum / (6m * count),
                new(totals.Cleanliness / (decimal)count, totals.Staff / (decimal)count, totals.Comfort / (decimal)count,
                    totals.Facilities / (decimal)count, totals.Location / (decimal)count, totals.Value / (decimal)count));
        var recentSums = await query.OrderByDescending(v => v.CreatedAtUtc).ThenByDescending(v => v.Id)
            .Select(v => v.RatingSum!.Value).Take(10).ToListAsync(ct);
        summary = summary with { RecentRatings = recentSums.Select(sum => sum / 6m).ToArray() };
        var items = await PublicProjection(query.OrderByDescending(v => v.CreatedAtUtc).ThenByDescending(v => v.Id)
            .Skip((page - 1) * pageSize).Take(pageSize), includeStayMetadata: true).ToListAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return new(summary, new() { Page = page, PageSize = pageSize, TotalCount = count,
            TotalPages = (int)Math.Ceiling(count / (double)pageSize), Items = items.Select(v => v.Response()).ToList() });
    }
}
