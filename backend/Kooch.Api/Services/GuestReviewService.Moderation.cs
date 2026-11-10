using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Kooch.Api.Services;

public sealed partial class GuestReviewService
{
    private async Task EnsureModeratorAsync(int userId, CancellationToken ct)
    {
        if (!await context.Users.AnyAsync(u => u.Id == userId && u.IsActive && u.Role == UserRole.SuperAdmin, ct))
            throw new UnauthorizedAccessException("SuperAdmin review moderation required.");
    }

    private IQueryable<Review> ModeratableReviews() => context.Reviews.Where(v => !v.IsDeleted &&
        v.RatingSum != null && v.ReservationId != null && v.ModerationStatus != null &&
        !v.Property.IsDeleted && v.Reservation != null && !v.Reservation.IsDeleted && v.Reservation.PropertyId == v.PropertyId);

    private static IQueryable<AdminReviewResponse> ModerationProjection(IQueryable<Review> query) => query
        .Select(v => new AdminReviewResponse(Response(v), v.Property.Name,
            v.Client.FirstName == "" ? "مهمان" : v.Client.FirstName,
            v.Reservation!.ReservationNumber, v.Reservation.CheckInDate, v.Reservation.CheckOutDate,
            v.CreatedAtUtc, v.ModeratedByUserId, v.ModeratedAtUtc, v.UnpublicationReason));

    public async Task<PagedResult<AdminReviewResponse>> ListForModerationAsync(
        int userId, AdminReviewQuery request, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct);
        if (request.Page is < 1 or > 100000 || request.PageSize is < 1 or > 100 || request.PropertyId is <= 0 ||
            request.Search?.Length > 200 || request.Status.HasValue && !Enum.IsDefined(request.Status.Value))
            throw new ArgumentException("Invalid review filters or pagination.");
        var query = ModeratableReviews().AsNoTracking();
        if (request.Status.HasValue) query = query.Where(v => v.ModerationStatus == request.Status);
        if (request.Published.HasValue) query = query.Where(v => v.IsPublished == request.Published);
        if (request.PropertyId.HasValue) query = query.Where(v => v.PropertyId == request.PropertyId);
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(v => v.Property.Name.Contains(search) ||
                v.Reservation!.ReservationNumber != null && v.Reservation.ReservationNumber.Contains(search));
        }
        var total = await query.CountAsync(ct);
        var sorted = request.Status == ReviewModerationStatus.PendingApproval
            ? query.OrderBy(v => v.CreatedAtUtc).ThenBy(v => v.Id)
            : query.OrderByDescending(v => v.CreatedAtUtc).ThenByDescending(v => v.Id);
        var items = await ModerationProjection(sorted.Skip((request.Page - 1) * request.PageSize).Take(request.PageSize)).ToListAsync(ct);
        return new() { Page = request.Page, PageSize = request.PageSize, TotalCount = total,
            TotalPages = (int)Math.Ceiling(total / (double)request.PageSize), Items = items };
    }

    public async Task<AdminReviewResponse> GetForModerationAsync(int userId, int reviewId, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct);
        return await ModerationProjection(ModeratableReviews().AsNoTracking().Where(v => v.Id == reviewId))
            .SingleOrDefaultAsync(ct) ?? throw new KeyNotFoundException("Review not found.");
    }

    public async Task<AdminReviewResponse> ModerateAsync(int userId, int reviewId, ModerateReviewRequest request,
        bool approve, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct);
        var reason = request.RejectionReason?.Trim();
        if (request.Revision < 1 || !approve && (string.IsNullOrWhiteSpace(reason) || reason.Length < 5 || reason.Length > 1000 || !reason.Any(char.IsLetterOrDigit)))
            throw new ArgumentException("ReviewRejectionReasonRequired: provide a meaningful reason of 5 to 1000 characters and the current revision.");
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(ct) : null;
        var review = await ModeratableReviews().SingleOrDefaultAsync(v => v.Id == reviewId, ct)
            ?? throw new KeyNotFoundException("Review not found.");
        if (review.Revision != request.Revision || review.ModerationStatus != ReviewModerationStatus.PendingApproval)
            throw new InvalidOperationException("ReviewModerationConflict: reload the review before deciding.");
        var previous = DecisionSnapshot(review);
        review.ModerationStatus = approve ? ReviewModerationStatus.Approved : ReviewModerationStatus.Rejected;
        review.IsPublished = approve;
        review.RejectionReason = approve ? null : reason;
        review.ModeratedByUserId = userId;
        review.ModeratedAtUtc = clock.GetUtcNow().UtcDateTime;
        review.UpdatedByUserId = userId;
        review.Revision = checked(review.Revision + 1);
        context.AuditLogs.Add(new AuditLog { UserId = userId, PropertyId = review.PropertyId,
            Action = approve ? AuditAction.ReviewApproved : AuditAction.ReviewRejected,
            EntityType = nameof(Review), EntityId = review.Id, EntityName = $"Reservation:{review.ReservationId}",
            PreviousValuesJson = JsonSerializer.Serialize(previous), NewValuesJson = JsonSerializer.Serialize(DecisionSnapshot(review)),
            OccurredAtUtc = clock.GetUtcNow().UtcDateTime });
        try { await context.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw new InvalidOperationException("ReviewModerationConflict: reload the review before deciding."); }
        if (transaction is not null) await transaction.CommitAsync(ct);
        return await GetForModerationAsync(userId, reviewId, ct);
    }

    private static object DecisionSnapshot(Review review) => new
    { Review = Response(review), review.ModeratedByUserId, review.ModeratedAtUtc, review.UnpublicationReason };
}
