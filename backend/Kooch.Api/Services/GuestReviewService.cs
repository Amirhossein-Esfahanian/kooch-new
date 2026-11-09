using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reviews;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class GuestReviewService(KoochDbContext context, TimeProvider clock)
{
    public async Task<PagedResult<GuestReviewListItemResponse>> ListAsync(
        int userId, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        await EnsureUserAsync(userId, ct);
        if (page < 1 || pageSize is < 1 or > 100 || page > 100000)
            throw new ArgumentException("Invalid review pagination.");
        var owned = context.Reservations.ForGuestUser(userId)
            .Where(r => !r.IsDeleted && !r.Property.IsDeleted);
        // Legacy ratings have no six-category verified-stay contract. Never reinterpret them.
        var query = context.Reviews.AsNoTracking().Where(v => !v.IsDeleted && v.ClientId == userId &&
            v.RatingSum != null && v.ReservationId != null &&
            (v.ModerationStatus == ReviewModerationStatus.PendingApproval ||
             v.ModerationStatus == ReviewModerationStatus.Approved || v.ModerationStatus == ReviewModerationStatus.Rejected) &&
            owned.Any(r => r.Id == v.ReservationId && r.PropertyId == v.PropertyId));
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(v => v.CreatedAtUtc).ThenByDescending(v => v.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(v => new { Review = v, v.Reservation!.ReservationNumber, v.Reservation.Property.Name,
                v.Reservation.CheckInDate, v.Reservation.CheckOutDate }).ToListAsync(ct);
        var ids = items.Select(v => v.Review.ReservationId!.Value).ToArray();
        var localNow = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone);
        var today = DateOnly.FromDateTime(localNow.DateTime);
        var localTime = TimeOnly.FromDateTime(localNow.DateTime);
        var earliest = today.AddDays(-30);
        var editableIds = await EligibleStays(userId).Where(r => ids.Contains(r.Id) &&
                r.CheckOutDate >= earliest && r.CheckOutDate <= today &&
                (r.CheckOutDate < today || (r.Property.CheckOutTime ?? new TimeOnly(12, 0)) <= localTime))
            .Select(r => r.Id).ToListAsync(ct);
        return new PagedResult<GuestReviewListItemResponse>
        {
            Page = page, PageSize = pageSize, TotalCount = total, TotalPages = (int)Math.Ceiling(total / (double)pageSize),
            Items = items.Select(v => new GuestReviewListItemResponse(v.ReservationNumber, v.Name,
                v.CheckInDate, v.CheckOutDate, v.CheckOutDate.AddDays(30), Response(v.Review),
                editableIds.Contains(v.Review.ReservationId!.Value) && v.Review.ModerationStatus is
                    ReviewModerationStatus.PendingApproval or ReviewModerationStatus.Rejected)).ToList()
        };
    }

    public async Task<PagedResult<EligibleReviewReservationResponse>> EligibleAsync(
        int userId, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        await EnsureUserAsync(userId, ct);
        if (page < 1 || pageSize is < 1 or > 100 || page > 100000)
            throw new ArgumentException("Invalid review pagination.");
        var localNow = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), IranSiteTime.BusinessTimeZone);
        var today = DateOnly.FromDateTime(localNow.DateTime);
        var localTime = TimeOnly.FromDateTime(localNow.DateTime);
        var earliest = today.AddDays(-30);
        var query = EligibleStays(userId).Where(r => r.CheckOutDate >= earliest && r.CheckOutDate <= today)
            .Where(r => r.CheckOutDate < today || (r.Property.CheckOutTime ?? new TimeOnly(12, 0)) <= localTime)
            .Where(r => !context.Reviews.IgnoreQueryFilters().Any(v => v.ReservationId == r.Id) ||
                context.Reviews.IgnoreQueryFilters().Any(v => v.ReservationId == r.Id && !v.IsDeleted &&
                    v.ClientId == userId && v.PropertyId == r.PropertyId && v.RatingSum != null &&
                    (v.ModerationStatus == ReviewModerationStatus.PendingApproval || v.ModerationStatus == ReviewModerationStatus.Rejected)));
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(r => r.CheckOutDate).ThenBy(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new { r.Id, r.ReservationNumber, r.PropertyId, r.Property.Name, r.CheckOutDate,
                ReviewId = context.Reviews.Where(v => v.ReservationId == r.Id && v.ClientId == userId).Select(v => (int?)v.Id).FirstOrDefault(),
                Revision = context.Reviews.Where(v => v.ReservationId == r.Id && v.ClientId == userId).Select(v => (int?)v.Revision).FirstOrDefault() })
            .ToListAsync(ct);
        return new PagedResult<EligibleReviewReservationResponse>
        {
            Page = page, PageSize = pageSize, TotalCount = total, TotalPages = (int)Math.Ceiling(total / (double)pageSize),
            Items = items.Select(r => new EligibleReviewReservationResponse(r.Id, r.ReservationNumber, r.PropertyId,
                r.Name, r.CheckOutDate, r.CheckOutDate.AddDays(30), r.ReviewId, r.Revision)).ToList()
        };
    }

    public async Task<GuestReviewResponse> GetAsync(int userId, int reservationId, CancellationToken ct = default)
    {
        await EnsureUserAsync(userId, ct);
        var propertyId = await context.Reservations.AsNoTracking().ForGuestUser(userId)
            .Where(r => r.Id == reservationId && !r.IsDeleted && !r.Property.IsDeleted).Select(r => (int?)r.PropertyId).SingleOrDefaultAsync(ct)
            ?? throw new KeyNotFoundException("Reservation not found.");
        var review = await context.Reviews.AsNoTracking().SingleOrDefaultAsync(v => v.ReservationId == reservationId &&
            v.ClientId == userId && v.PropertyId == propertyId && v.RatingSum != null, ct)
            ?? throw new KeyNotFoundException("Review not found.");
        return Response(review);
    }

    public async Task<GuestReviewResponse> SaveAsync(int userId, int reservationId, GuestReviewRequest request,
        bool edit, CancellationToken ct = default)
    {
        await EnsureUserAsync(userId, ct);
        Validate(request, edit);
        await using var transaction = context.Database.IsRelational() && context.Database.CurrentTransaction is null
            ? await context.Database.BeginTransactionAsync(ct) : null;
        // Serializes two authorized guests writing for the same Reservation, including the missing-review case.
        var reservations = context.Database.IsSqlServer()
            ? context.Reservations.FromSqlInterpolated($"SELECT * FROM [Reservations] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {reservationId}")
            : context.Reservations.AsQueryable();
        var reservation = await reservations.AsNoTracking().ForGuestUser(userId).Include(r => r.Property)
            .SingleOrDefaultAsync(r => r.Id == reservationId && !r.IsDeleted && !r.Property.IsDeleted, ct) ?? throw new KeyNotFoundException("Reservation not found.");
        await EnsureEligibleAsync(reservation, userId, ct);
        var review = await context.Reviews.IgnoreQueryFilters().SingleOrDefaultAsync(v => v.ReservationId == reservationId, ct);
        object? previous = null;
        if (edit)
        {
            if (review is null || review.ClientId != userId || review.PropertyId != reservation.PropertyId || review.IsDeleted || review.RatingSum is null)
                throw new KeyNotFoundException("Review not found.");
            if (review.ModerationStatus is not (ReviewModerationStatus.PendingApproval or ReviewModerationStatus.Rejected))
                throw new InvalidOperationException("ReviewNotEditable: only pending or rejected reviews can be edited.");
            if (request.Revision != review.Revision) throw new InvalidOperationException("ReviewRevisionConflict: reload the review.");
            previous = Response(review);
        }
        else
        {
            if (review is not null) throw new InvalidOperationException("ReviewAlreadyExists: a reservation can have only one review.");
            review = new Review { ReservationId = reservation.Id, PropertyId = reservation.PropertyId, ClientId = userId, CreatedByUserId = userId };
            context.Reviews.Add(review);
        }
        review.CleanlinessRating = request.CleanlinessRating;
        review.StaffRating = request.StaffRating;
        review.ComfortRating = request.ComfortRating;
        review.FacilitiesRating = request.FacilitiesRating;
        review.LocationRating = request.LocationRating;
        review.ValueRating = request.ValueRating;
        review.RatingSum = request.CleanlinessRating + request.StaffRating + request.ComfortRating + request.FacilitiesRating + request.LocationRating + request.ValueRating;
        review.Comment = request.Comment?.Trim() ?? string.Empty;
        review.ModerationStatus = ReviewModerationStatus.PendingApproval;
        review.IsPublished = false;
        review.Revision++;
        review.UpdatedByUserId = userId;
        try
        {
            await context.SaveChangesAsync(ct);
            // Capture the generated identity; both saves remain in the same database transaction.
            context.AuditLogs.Add(new AuditLog
            {
                UserId = userId, PropertyId = reservation.PropertyId, Action = edit ? AuditAction.ReviewEdited : AuditAction.ReviewSubmitted,
                EntityType = nameof(Review), EntityId = review.Id, EntityName = $"Reservation:{reservation.Id}",
                PreviousValuesJson = previous is null ? null : JsonSerializer.Serialize(previous),
                NewValuesJson = JsonSerializer.Serialize(Response(review)),
                OccurredAtUtc = clock.GetUtcNow().UtcDateTime
            });
            await context.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException) { throw new InvalidOperationException("ReviewRevisionConflict: reload the review."); }
        catch (DbUpdateException error) when (error.InnerException is SqlException { Number: 2601 or 2627 } sql && sql.Message.Contains("IX_Reviews_ReservationId", StringComparison.Ordinal))
        { throw new InvalidOperationException("ReviewAlreadyExists: a reservation can have only one review."); }
        if (transaction is not null) await transaction.CommitAsync(ct);
        return Response(review);
    }

    private IQueryable<Reservation> EligibleStays(int userId) => context.Reservations.AsNoTracking().ForGuestUser(userId)
        // IgnoreQueryFilters in historical subqueries also affects composed joins: explicitly retain soft-delete boundaries.
        .Where(r => r.ClientId == userId || r.Guest != null && !r.Guest.IsDeleted)
        .Where(r => !r.IsDeleted && r.Status == ReservationStatus.Completed && r.CancelledAtUtc == null && !r.Property.IsDeleted &&
            r.CheckInDate < r.CheckOutDate && !context.CancellationFinancialResolutions.IgnoreQueryFilters().Any(c => c.ReservationId == r.Id) &&
            !context.RefundRecords.IgnoreQueryFilters().Any(f => f.ReservationId == r.Id));

    private async Task EnsureEligibleAsync(Reservation reservation, int userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, IranSiteTime.BusinessTimeZone).DateTime);
        if (!await EligibleStays(userId).AnyAsync(r => r.Id == reservation.Id, ct) ||
            today < reservation.CheckOutDate || today.DayNumber - reservation.CheckOutDate.DayNumber > 30 ||
            now.UtcDateTime < IranSiteTime.ToUtc(reservation.CheckOutDate, reservation.Property.CheckOutTime ?? new TimeOnly(12, 0)))
            throw new InvalidOperationException("ReviewNotEligible: a completed stay within the 30-day local checkout window is required.");
    }

    private async Task EnsureUserAsync(int userId, CancellationToken ct)
    {
        if (!await context.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct))
            throw new UnauthorizedAccessException("Active authenticated user required.");
    }
    private static void Validate(GuestReviewRequest r, bool edit)
    {
        int[] scores = [r.CleanlinessRating, r.StaffRating, r.ComfortRating, r.FacilitiesRating, r.LocationRating, r.ValueRating];
        if (scores.Any(s => s is < 1 or > 10) || r.Comment?.Length > 4000 || (edit && r.Revision is not > 0))
            throw new ArgumentException("Six integer ratings from 1 to 10, an optional comment up to 4000 characters and the current revision on edit are required.");
    }
    private static GuestReviewResponse Response(Review v) => new(v.Id, v.ReservationId!.Value, v.PropertyId,
        v.CleanlinessRating!.Value, v.StaffRating!.Value, v.ComfortRating!.Value, v.FacilitiesRating!.Value,
        v.LocationRating!.Value, v.ValueRating!.Value, v.RatingSum!.Value, v.RatingSum.Value / 6m,
        v.Comment, v.ModerationStatus!.Value, v.IsPublished, v.Revision);
}
