using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class ReservationActivityService(KoochDbContext context, IPermissionService? permissions = null)
{
    private static readonly string[] OwnerVisibleActivityTypes =
        ["Created", "Cancelled", "PaymentConfirmed", "Approved", "Rejected"];

    public Task<ReservationActivity> AppendPaymentConfirmedAsync(
        int reservationId, int? actorUserId, CancellationToken cancellationToken = default) =>
        AppendAsync(reservationId, actorUserId, "PaymentConfirmed",
            ReservationActivityVisibility.PropertyVisible, "پرداخت تأیید شد",
            cancellationToken: cancellationToken);

    public async Task<ReservationActivityResponse> CreateInternalNoteAsync(
        int reservationId, int actorUserId, string? details, CancellationToken cancellationToken = default)
    {
        var permissionService = permissions ?? throw new InvalidOperationException("Activity permissions are not configured.");
        var propertyId = await context.Reservations.AsNoTracking()
            .Where(row => row.Id == reservationId)
            .Select(row => (int?)row.PropertyId)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        if (!await permissionService.HasPermissionAsync(actorUserId, PermissionKey.ManageReservations,
                cancellationToken: cancellationToken) ||
            !await permissionService.CanAsync(actorUserId, propertyId, "bookings.edit", cancellationToken))
            throw new UnauthorizedAccessException("You cannot manage this property's reservations.");
        if (string.IsNullOrWhiteSpace(details))
            throw new ArgumentException("Internal note details are required.", nameof(details));

        var activity = await AppendAsync(reservationId, actorUserId, "InternalNote",
            ReservationActivityVisibility.Internal, "یادداشت داخلی", details, cancellationToken: cancellationToken);
        return new ReservationActivityResponse
        {
            Id = activity.Id,
            ReservationId = activity.ReservationId,
            ActorUserId = activity.ActorUserId,
            ActorDisplayName = activity.ActorDisplayName,
            ActivityType = activity.ActivityType,
            Visibility = activity.Visibility,
            Title = activity.Title,
            Details = activity.Details,
            OccurredAtUtc = activity.OccurredAtUtc,
            RelatedEntityType = activity.RelatedEntityType,
            RelatedEntityId = activity.RelatedEntityId
        };
    }

    public async Task<ReservationActivity> AppendAsync(
        int reservationId,
        int? actorUserId,
        string activityType,
        ReservationActivityVisibility visibility,
        string title,
        string? details = null,
        string? relatedEntityType = null,
        int? relatedEntityId = null,
        CancellationToken cancellationToken = default)
    {
        if (!await context.Reservations.AnyAsync(row => row.Id == reservationId, cancellationToken))
            throw new KeyNotFoundException("Reservation not found.");
        if (!Enum.IsDefined(visibility))
            throw new ArgumentOutOfRangeException(nameof(visibility));

        var type = Required(activityType, 100, nameof(activityType));
        var activityTitle = Required(title, 250, nameof(title));
        var activityDetails = Optional(details, 4000, nameof(details));
        var relatedType = Optional(relatedEntityType, 100, nameof(relatedEntityType));
        if ((relatedType is null) != (relatedEntityId is null) || relatedEntityId is <= 0)
            throw new ArgumentException("Related entity type and ID must be supplied together.");

        string actorName;
        if (actorUserId is null)
        {
            actorName = "System";
        }
        else
        {
            var actor = await context.Users.AsNoTracking()
                .Where(user => user.Id == actorUserId)
                .Select(user => new { user.FirstName, user.LastName, user.Username, user.Email })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw new KeyNotFoundException("Activity actor not found.");
            actorName = $"{actor.FirstName} {actor.LastName}".Trim();
            if (actorName.Length == 0) actorName = actor.Username?.Trim() ?? string.Empty;
            if (actorName.Length == 0) actorName = actor.Email?.Trim() ?? string.Empty;
            if (actorName.Length == 0)
                throw new InvalidOperationException("Activity actor has no display name.");
            if (actorName.Length > 200)
                throw new InvalidOperationException("Activity actor display name is too long.");
        }

        var activity = new ReservationActivity
        {
            ReservationId = reservationId,
            ActorUserId = actorUserId,
            ActorDisplayName = actorName,
            ActivityType = type,
            Visibility = visibility,
            Title = activityTitle,
            Details = activityDetails,
            OccurredAtUtc = DateTime.UtcNow,
            RelatedEntityType = relatedType,
            RelatedEntityId = relatedEntityId
        };
        context.ReservationActivities.Add(activity);
        await context.SaveChangesAsync(cancellationToken);
        return activity;
    }

    public async Task<IReadOnlyList<ReservationActivityResponse>> ListForAdminAsync(
        int reservationId, int userId, CancellationToken cancellationToken = default)
    {
        var permissionService = permissions ?? throw new InvalidOperationException("Activity permissions are not configured.");
        var propertyId = await context.Reservations.AsNoTracking()
            .Where(row => row.Id == reservationId)
            .Select(row => (int?)row.PropertyId)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        if (!await permissionService.CanAsync(userId, propertyId, "bookings.view", cancellationToken))
            throw new UnauthorizedAccessException("You cannot access this property's reservations.");

        return await context.ReservationActivities.AsNoTracking()
            .Where(row => row.ReservationId == reservationId)
            .OrderBy(row => row.OccurredAtUtc)
            .ThenBy(row => row.Id)
            .Select(row => new ReservationActivityResponse
            {
                Id = row.Id,
                ReservationId = row.ReservationId,
                ActorUserId = row.ActorUserId,
                ActorDisplayName = row.ActorDisplayName,
                ActivityType = row.ActivityType,
                Visibility = row.Visibility,
                Title = row.Title,
                Details = row.Details,
                OccurredAtUtc = row.OccurredAtUtc,
                RelatedEntityType = row.RelatedEntityType,
                RelatedEntityId = row.RelatedEntityId
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PagedResult<OwnerReservationActivityResponse>> ListForOwnerAsync(
        int propertyId, int reservationId, int userId, OwnerReservationActivityQuery query,
        CancellationToken cancellationToken = default)
    {
        var permissionService = permissions ?? throw new InvalidOperationException("Activity permissions are not configured.");
        if (!await permissionService.CanAsync(userId, propertyId, "bookings.view", cancellationToken))
            throw new UnauthorizedAccessException("You cannot access this property's reservations.");
        if (!await context.Reservations.AsNoTracking()
                .AnyAsync(row => row.Id == reservationId && row.PropertyId == propertyId, cancellationToken))
            throw new KeyNotFoundException("Reservation not found.");

        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 50);
        var visible = context.ReservationActivities.AsNoTracking()
            .Where(row => row.ReservationId == reservationId &&
                row.Visibility == ReservationActivityVisibility.PropertyVisible &&
                OwnerVisibleActivityTypes.Contains(row.ActivityType) &&
                row.RelatedEntityType == null);
        var totalCount = await visible.CountAsync(cancellationToken);
        var items = await visible
            .OrderBy(row => row.OccurredAtUtc)
            .ThenBy(row => row.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(row => new OwnerReservationActivityResponse
            {
                ActivityType = row.ActivityType,
                Title = row.Title,
                Details = row.Details,
                ActorDisplayName = row.ActorDisplayName,
                OccurredAtUtc = row.OccurredAtUtc
            })
            .ToListAsync(cancellationToken);
        return new PagedResult<OwnerReservationActivityResponse>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    private static string Required(string value, int maxLength, string name) =>
        Optional(value, maxLength, name)
        ?? throw new ArgumentException("Value is required.", name);

    private static string? Optional(string? value, int maxLength, string name)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        if (trimmed.Length > maxLength)
            throw new ArgumentException($"Value exceeds {maxLength} characters.", name);
        return trimmed;
    }
}
