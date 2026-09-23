using Kooch.Api.Data;
using Kooch.Api.Dtos.Reports;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AdminReportService(
    KoochDbContext dbContext,
    PropertyAccessService propertyAccessService,
    IPermissionService permissionService) : IAdminReportService
{
    public async Task<AdminReservationReportResponse> GetReservationsAsync(
        int userId, UserRole role, AdminReservationReportQuery query,
        CancellationToken cancellationToken = default)
    {
        if (role is not UserRole.SuperAdmin and not UserRole.AdminAssistant ||
            !await permissionService.HasPermissionAsync(userId, PermissionKey.ViewReports,
                cancellationToken: cancellationToken))
        {
            throw new UnauthorizedAccessException("ViewReports permission is required.");
        }

        if (query.From > query.To || query.To == DateOnly.MaxValue)
        {
            throw new ArgumentException("بازه تاریخ گزارش معتبر نیست.");
        }
        var status = query.Status.HasValue ? ReservationStatusNormalizer.Normalize(query.Status.Value) : (ReservationStatus?)null;
        if (status.HasValue && !Enum.IsDefined(status.Value))
        {
            throw new ArgumentException("وضعیت رزرو معتبر نیست.");
        }

        var visibleIds = await propertyAccessService.GetPropertyIdsWithPermissionAsync(
            userId, "reports.view", cancellationToken);
        var options = await dbContext.Properties.AsNoTracking()
            .Where(property => visibleIds.Contains(property.Id))
            .OrderBy(property => property.Name).ThenBy(property => property.Id)
            .Select(property => new AdminReportPropertyOption(property.Id, property.Name))
            .ToListAsync(cancellationToken);
        if (query.PropertyId.HasValue && !options.Any(property => property.Id == query.PropertyId))
        {
            // Identical response for a hidden property and an unknown property.
            throw new UnauthorizedAccessException("You cannot view reports for this property.");
        }

        // Report calendar days are explicitly UTC, matching the stored creation timestamps.
        var from = query.From?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var to = query.To?.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var reservations = dbContext.Reservations.AsNoTracking()
            .Where(reservation => visibleIds.Contains(reservation.PropertyId));
        if (from.HasValue) reservations = reservations.Where(reservation => reservation.CreatedAtUtc >= from.Value);
        if (to.HasValue) reservations = reservations.Where(reservation => reservation.CreatedAtUtc < to.Value);
        if (query.PropertyId.HasValue) reservations = reservations.Where(reservation => reservation.PropertyId == query.PropertyId.Value);

        // SQL-translatable equivalent of ReservationStatusNormalizer; never mutate legacy rows.
        var normalized = reservations.Select(reservation => new
        {
            reservation.Id,
            reservation.PropertyId,
            PropertyName = reservation.Property.Name,
            Date = reservation.CreatedAtUtc.Date,
            Status = reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval
                ? ReservationStatus.PendingApproval
                : reservation.Status == ReservationStatusNormalizer.LegacyPaymentExpired
                    ? ReservationStatus.PaymentExpired
                    : reservation.Status
        });
        if (status.HasValue) normalized = normalized.Where(reservation => reservation.Status == status.Value);

        // One aggregate cube, not reservation rows: all breakdowns share the same snapshot.
        var counts = await normalized
            .GroupBy(reservation => new { reservation.Date, reservation.PropertyId, reservation.PropertyName, reservation.Status })
            .Select(group => new { group.Key, Count = group.Select(reservation => reservation.Id).Distinct().Count() })
            .ToListAsync(cancellationToken);
        var statuses = counts.GroupBy(item => item.Key.Status).OrderBy(group => group.Key)
            .Select(group => new AdminReportStatusCount(group.Key, group.Sum(item => item.Count))).ToArray();
        var trend = counts.GroupBy(item => item.Key.Date).OrderBy(group => group.Key)
            .Select(group => new AdminReportTrend(DateOnly.FromDateTime(group.Key), group.Sum(item => item.Count))).ToArray();
        var properties = counts.GroupBy(item => new { item.Key.PropertyId, item.Key.PropertyName })
            .OrderByDescending(group => group.Sum(item => item.Count)).ThenBy(group => group.Key.PropertyId)
            .Select(group => new AdminReportPropertyCount(group.Key.PropertyId, group.Key.PropertyName, group.Sum(item => item.Count))).ToArray();

        return new AdminReservationReportResponse(
            new(query.From, query.To, query.PropertyId, status, "UTC", from, to),
            new(counts.Sum(item => item.Count), statuses), trend, properties, statuses, options);
    }
}
