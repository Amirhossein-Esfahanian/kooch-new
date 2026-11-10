using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed partial class GuestReviewService
{
    private async Task EnsurePropertyReviewsAsync(int userId, int propertyId, bool reply, CancellationToken ct)
    {
        await EnsureUserAsync(userId, ct);
        var authorization = propertyAuthorization ?? new PropertyAccessService(context);
        if (!await authorization.HasPropertyPermissionAsync(userId, propertyId, "reviews.view", ct) ||
            reply && !await authorization.HasPropertyPermissionAsync(userId, propertyId, "reviews.reply", ct))
            throw new UnauthorizedAccessException("Property review permission required.");
    }
    private static OwnerReplyResponse ReplyResponse(ReviewOwnerReply r) => new(r.Id, r.ReviewId, r.Body,
        r.ModerationStatus, r.Revision, r.ModerationStatus == ReviewModerationStatus.Rejected ? r.RejectionReason : null,
        r.PublishedBody, r.PublishedAtUtc);
    private static object ReplySnapshot(ReviewOwnerReply r) => new { Reply = ReplyResponse(r), r.SubmittedByUserId,
        r.ModeratedByUserId, r.ModeratedAtUtc, r.PublishedRevision };

    public async Task<PagedResult<OwnerReviewResponse>> ListOwnerReviewsAsync(int userId, int propertyId,
        string filter = "All", int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        await EnsurePropertyReviewsAsync(userId, propertyId, false, ct); ValidatePage(page, pageSize);
        var query = PublishedReviews().AsNoTracking().Where(v => v.PropertyId == propertyId);
        var replies = context.ReviewOwnerReplies.AsNoTracking();
        if (filter == "PendingApproval") query = query.Where(v => replies.Any(r => r.ReviewId == v.Id && r.ModerationStatus == ReviewModerationStatus.PendingApproval));
        else if (filter == "Answered") query = query.Where(v => replies.Any(r => r.ReviewId == v.Id && r.PublishedBody != null));
        else if (filter == "Unanswered") query = query.Where(v => !replies.Any(r => r.ReviewId == v.Id &&
            (r.PublishedBody != null || r.ModerationStatus == ReviewModerationStatus.PendingApproval)));
        else if (filter != "All") throw new ArgumentException("Invalid owner review filter.");
        var count = await query.CountAsync(ct);
        var reviews = await PublicProjection(query.OrderByDescending(v => v.CreatedAtUtc).ThenByDescending(v => v.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync(ct);
        var ids = reviews.Select(v => v.Id).ToArray();
        var drafts = await replies.Where(r => ids.Contains(r.ReviewId)).ToDictionaryAsync(r => r.ReviewId, ct);
        return new() { Page = page, PageSize = pageSize, TotalCount = count, TotalPages = (int)Math.Ceiling(count / (double)pageSize),
            Items = reviews.Select(v => new OwnerReviewResponse(v.Response(), drafts.TryGetValue(v.Id, out var r) ? ReplyResponse(r) : null)).ToList() };
    }

    public async Task<OwnerReplyResponse> SaveOwnerReplyAsync(int userId, int propertyId, int reviewId,
        OwnerReplyRequest request, CancellationToken ct = default)
    {
        await EnsurePropertyReviewsAsync(userId, propertyId, true, ct);
        var body = request.Body?.Trim();
        if (string.IsNullOrWhiteSpace(body) || body.Length > 2000 || request.Revision is <= 0)
            throw new ArgumentException("A response of 1 to 2000 characters and the current revision on edit are required.");
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(ct) : null;
        await ReviewWriteLock(reviewId).AsNoTracking().SingleOrDefaultAsync(ct);
        await EnsurePropertyReviewsAsync(userId, propertyId, true, ct);
        if (!await PublishedReviews().AnyAsync(v => v.Id == reviewId && v.PropertyId == propertyId, ct))
            throw new KeyNotFoundException("Published review not found for this property.");
        var row = await context.ReviewOwnerReplies.IgnoreQueryFilters().SingleOrDefaultAsync(r => r.ReviewId == reviewId, ct);
        object? previous = row is null ? null : ReplySnapshot(row);
        if (row is null)
        {
            if (request.Revision.HasValue) throw new InvalidOperationException("ReviewReplyConflict: reload the response.");
            row = new ReviewOwnerReply { ReviewId = reviewId, SubmittedByUserId = userId, CreatedByUserId = userId, Body = body };
            context.ReviewOwnerReplies.Add(row);
        }
        else
        {
            if (row.IsDeleted) throw new InvalidOperationException("ReviewReplyConflict: response unavailable.");
            // A network replay never overwrites a later draft or creates a second official response.
            if (row.ModerationStatus == ReviewModerationStatus.PendingApproval && row.SubmittedByUserId == userId && row.Body == body &&
                (request.Revision == row.Revision - 1 || request.Revision == row.Revision || request.Revision is null && row.Revision == 1))
            { if (transaction is not null) await transaction.CommitAsync(ct); return ReplyResponse(row); }
            if (request.Revision != row.Revision) throw new InvalidOperationException("ReviewReplyConflict: reload the current revision.");
            row.Body = body; row.SubmittedByUserId = userId; row.Revision = checked(row.Revision + 1);
            row.ModerationStatus = ReviewModerationStatus.PendingApproval;
            row.RejectionReason = null; row.ModeratedAtUtc = null; row.ModeratedByUserId = null;
            row.UpdatedByUserId = userId;
        }
        await SaveReviewChangesAsync(ct);
        AddReviewAudit(userId, propertyId, previous is null ? AuditAction.ReviewReplySubmitted : AuditAction.ReviewReplyEdited,
            nameof(ReviewOwnerReply), row.Id, previous, ReplySnapshot(row));
        await SaveReviewChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return ReplyResponse(row);
    }

    private IQueryable<ReviewOwnerReply> ModeratableReplies() => context.ReviewOwnerReplies.Where(r =>
        !r.IsDeleted && PublishedReviews().Any(v => v.Id == r.ReviewId));

    public async Task<PagedResult<AdminOwnerReplyResponse>> ListRepliesForModerationAsync(int userId,
        AdminReviewQuery request, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct); ValidatePage(request.Page, request.PageSize);
        if (request.Status.HasValue && !Enum.IsDefined(request.Status.Value) || request.PropertyId is <= 0 || request.Search?.Length > 200)
            throw new ArgumentException("Invalid response filters.");
        var query = ModeratableReplies().AsNoTracking();
        if (request.Status.HasValue) query = query.Where(r => r.ModerationStatus == request.Status);
        if (request.PropertyId.HasValue) query = query.Where(r => r.Review.PropertyId == request.PropertyId);
        if (!string.IsNullOrWhiteSpace(request.Search)) { var search = request.Search.Trim(); query = query.Where(r => r.Review.Property.Name.Contains(search)); }
        var count = await query.CountAsync(ct);
        // Moderation also updates UpdatedAtUtc; only submission/edit audits identify a new owner revision.
        var submissions = query.Select(r => new { Reply = r, SubmittedAtUtc = context.AuditLogs
            .Where(a => a.EntityType == nameof(ReviewOwnerReply) && a.EntityId == r.Id &&
                (a.Action == AuditAction.ReviewReplySubmitted || a.Action == AuditAction.ReviewReplyEdited))
            .Max(a => (DateTime?)a.OccurredAtUtc) ?? r.CreatedAtUtc });
        var pageRows = await submissions.OrderByDescending(r => r.SubmittedAtUtc).ThenByDescending(r => r.Reply.Id)
            .Skip((request.Page - 1) * request.PageSize).Take(request.PageSize).ToListAsync(ct);
        var rows = pageRows.Select(r => r.Reply).ToList();
        var submittedAt = pageRows.ToDictionary(r => r.Reply.Id, r => r.SubmittedAtUtc);
        var ids = rows.Select(r => r.ReviewId).ToArray();
        var guests = await PublicProjection(PublishedReviews().AsNoTracking().Where(v => ids.Contains(v.Id))).ToDictionaryAsync(v => v.Id, ct);
        var names = await context.Reviews.Where(v => ids.Contains(v.Id)).Select(v => new { v.Id, v.PropertyId, v.Property.Name }).ToDictionaryAsync(v => v.Id, ct);
        return new() { Page = request.Page, PageSize = request.PageSize, TotalCount = count,
            TotalPages = (int)Math.Ceiling(count / (double)request.PageSize), Items = rows.Where(r => guests.ContainsKey(r.ReviewId) && names.ContainsKey(r.ReviewId))
                .Select(r => new AdminOwnerReplyResponse(ReplyResponse(r), names[r.ReviewId].PropertyId, names[r.ReviewId].Name,
                    guests[r.ReviewId].Response(), r.SubmittedByUserId, r.ModeratedByUserId, r.ModeratedAtUtc, submittedAt[r.Id])).ToList() };
    }

    public async Task<OwnerReplyResponse> ModerateReplyAsync(int userId, int replyId, ModerateReviewRequest request,
        bool approve, CancellationToken ct = default)
    {
        await EnsureModeratorAsync(userId, ct);
        var reason = request.RejectionReason?.Trim();
        if (request.Revision < 1 || !approve && !MeaningfulReason(reason)) throw new ArgumentException("A meaningful rejection reason and current revision are required.");
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(ct) : null;
        var reviewId = await context.ReviewOwnerReplies.AsNoTracking().Where(r => r.Id == replyId).Select(r => (int?)r.ReviewId)
            .SingleOrDefaultAsync(ct) ?? throw new KeyNotFoundException("Response not found.");
        await ReviewWriteLock(reviewId).AsNoTracking().SingleOrDefaultAsync(ct);
        var row = await ModeratableReplies().SingleOrDefaultAsync(r => r.Id == replyId, ct) ?? throw new KeyNotFoundException("Published review response not found.");
        if (row.Revision != request.Revision || row.ModerationStatus != ReviewModerationStatus.PendingApproval)
            throw new InvalidOperationException("ReviewReplyConflict: reload the response before deciding.");
        var previous = ReplySnapshot(row);
        row.ModerationStatus = approve ? ReviewModerationStatus.Approved : ReviewModerationStatus.Rejected;
        row.RejectionReason = approve ? null : reason; row.ModeratedByUserId = userId;
        row.ModeratedAtUtc = clock.GetUtcNow().UtcDateTime; row.UpdatedByUserId = userId;
        row.Revision = checked(row.Revision + 1);
        if (approve) { row.PublishedBody = row.Body; row.PublishedAtUtc = row.ModeratedAtUtc; row.PublishedRevision = row.Revision; }
        AddReviewAudit(userId, (await context.Reviews.Where(v => v.Id == reviewId).Select(v => v.PropertyId).SingleAsync(ct)),
            approve ? AuditAction.ReviewReplyApproved : AuditAction.ReviewReplyRejected, nameof(ReviewOwnerReply), row.Id, previous, ReplySnapshot(row));
        await SaveReviewChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return ReplyResponse(row);
    }
}
