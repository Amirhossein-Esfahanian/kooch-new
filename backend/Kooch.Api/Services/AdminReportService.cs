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
        var selectedPropertyTypes = (query.PropertyTypes ?? [])
            .Distinct()
            .ToArray();
        if (selectedPropertyTypes.Any(propertyType => !Enum.IsDefined(propertyType)))
        {
            throw new ArgumentException("نوع اقامتگاه معتبر نیست.");
        }

        var visibleIds = await propertyAccessService.GetPropertyIdsWithPermissionAsync(
            userId, "reports.view", cancellationToken);
        var selectedPropertyIds = (query.PropertyIds ?? [])
            .Where(propertyId => propertyId > 0)
            .Distinct()
            .ToArray();
        var options = await dbContext.Properties.AsNoTracking()
            .Where(property => visibleIds.Contains(property.Id))
            .OrderBy(property => property.Name).ThenBy(property => property.Id)
            .Select(property => new AdminReportPropertyOption(property.Id, property.Name))
            .ToListAsync(cancellationToken);
        var visibleIdSet = options.Select(property => property.Id).ToHashSet();
        if (selectedPropertyIds.Any(propertyId => !visibleIdSet.Contains(propertyId)))
        {
            // Identical response for a hidden property and an unknown property.
            throw new UnauthorizedAccessException("You cannot view reports for this property.");
        }

        var reportablePropertyIds = selectedPropertyIds.Length > 0
            ? selectedPropertyIds
            : visibleIds.Distinct().ToArray();
        if (selectedPropertyTypes.Length > 0)
        {
            reportablePropertyIds = await dbContext.Properties.AsNoTracking()
                .Where(property => reportablePropertyIds.Contains(property.Id) &&
                    selectedPropertyTypes.Contains(property.Type))
                .Select(property => property.Id)
                .ToArrayAsync(cancellationToken);
        }

        // Report calendar days are explicitly UTC, matching the stored creation timestamps.
        var from = query.From?.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var to = query.To?.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var reservations = dbContext.Reservations.AsNoTracking()
            .Where(reservation => reportablePropertyIds.Contains(reservation.PropertyId));
        if (from.HasValue) reservations = reservations.Where(reservation => reservation.CreatedAtUtc >= from.Value);
        if (to.HasValue) reservations = reservations.Where(reservation => reservation.CreatedAtUtc < to.Value);

        // SQL-translatable equivalent of ReservationStatusNormalizer; never mutate legacy rows.
        var normalized = reservations.Select(reservation => new
        {
            reservation.Id,
            reservation.PropertyId,
            PropertyName = reservation.Property.Name,
            Date = reservation.CreatedAtUtc.Date,
            reservation.FinalAmount,
            reservation.Currency,
            Status = reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval
                ? ReservationStatus.PendingApproval
                : reservation.Status == ReservationStatusNormalizer.LegacyPaymentExpired
                    ? ReservationStatus.PaymentExpired
                    : reservation.Status
        });
        if (status.HasValue) normalized = normalized.Where(reservation => reservation.Status == status.Value);

        // One aggregate cube, not reservation rows: all breakdowns share the same snapshot.
        var counts = await normalized
            .GroupBy(reservation => new { reservation.Date, reservation.PropertyId, reservation.PropertyName, reservation.Status, reservation.Currency })
            .Select(group => new
            {
                group.Key,
                Count = group.Select(reservation => reservation.Id).Distinct().Count(),
                BookingValue = group.Sum(reservation => reservation.FinalAmount)
            })
            .ToListAsync(cancellationToken);
        var statuses = counts.GroupBy(item => item.Key.Status).OrderBy(group => group.Key)
            .Select(group => new AdminReportStatusCount(group.Key, group.Sum(item => item.Count))).ToArray();
        var trend = counts.GroupBy(item => item.Key.Date).OrderBy(group => group.Key)
            .Select(group => new AdminReportTrend(DateOnly.FromDateTime(group.Key), group.Sum(item => item.Count))).ToArray();
        var properties = counts.GroupBy(item => new { item.Key.PropertyId, item.Key.PropertyName })
            .OrderByDescending(group => group.Sum(item => item.Count)).ThenBy(group => group.Key.PropertyId)
            .Select(group => new AdminReportPropertyCount(group.Key.PropertyId, group.Key.PropertyName, group.Sum(item => item.Count))).ToArray();
        var bookingValuesByCurrency = counts
            .GroupBy(item => item.Key.Currency)
            .Select(group => new { Currency = group.Key, Value = group.Sum(item => item.BookingValue) })
            .ToArray();
        var hasMixedCurrencies = bookingValuesByCurrency.Length > 1;
        var bookingValue = hasMixedCurrencies
            ? (decimal?)null
            : bookingValuesByCurrency.SingleOrDefault()?.Value ?? 0m;
        var bookingValueCurrency = hasMixedCurrencies
            ? null
            : bookingValuesByCurrency.SingleOrDefault()?.Currency;

        var directCollectedQuery = dbContext.Payments.AsNoTracking()
            .Where(payment => payment.Status == PaymentStatus.Successful &&
                payment.PaidAtUtc.HasValue &&
                payment.ReservationId.HasValue &&
                reportablePropertyIds.Contains(payment.Reservation!.PropertyId));
        var allocatedCollectedQuery = dbContext.PaymentItems.AsNoTracking()
            .Where(item => item.Payment.Status == PaymentStatus.Successful &&
                item.Payment.PaidAtUtc.HasValue &&
                item.Payment.BookingSessionId.HasValue &&
                reportablePropertyIds.Contains(item.Reservation.PropertyId));
        if (from.HasValue)
        {
            directCollectedQuery = directCollectedQuery.Where(payment => payment.PaidAtUtc >= from.Value);
            allocatedCollectedQuery = allocatedCollectedQuery.Where(item => item.Payment.PaidAtUtc >= from.Value);
        }
        if (to.HasValue)
        {
            directCollectedQuery = directCollectedQuery.Where(payment => payment.PaidAtUtc < to.Value);
            allocatedCollectedQuery = allocatedCollectedQuery.Where(item => item.Payment.PaidAtUtc < to.Value);
        }

        // Session payments are attributed only through their allocations; never add the parent Payment.Amount.
        var directCollectedByCurrency = await directCollectedQuery
            .GroupBy(payment => payment.Currency)
            .Select(group => new { Currency = group.Key, Amount = group.Sum(payment => payment.Amount) })
            .ToListAsync(cancellationToken);
        var allocatedCollectedByCurrency = await allocatedCollectedQuery
            .GroupBy(item => item.Currency)
            .Select(group => new { Currency = group.Key, Amount = group.Sum(item => item.AllocatedAmount) })
            .ToListAsync(cancellationToken);
        var collectedByCurrency = directCollectedByCurrency
            .Concat(allocatedCollectedByCurrency)
            .GroupBy(item => item.Currency)
            .Select(group => new { Currency = group.Key, Amount = group.Sum(item => item.Amount) })
            .ToArray();
        var collectedHasMixedCurrencies = collectedByCurrency.Length > 1;
        var collectedAmount = collectedHasMixedCurrencies
            ? (decimal?)null
            : collectedByCurrency.SingleOrDefault()?.Amount ?? 0m;
        var collectedCurrency = collectedHasMixedCurrencies
            ? null
            : collectedByCurrency.SingleOrDefault()?.Currency;

        return new AdminReservationReportResponse(
            new(query.From, query.To, selectedPropertyIds, selectedPropertyTypes, status, "UTC", from, to),
            new(counts.Sum(item => item.Count), bookingValue, bookingValueCurrency, hasMixedCurrencies,
                collectedAmount, collectedCurrency, collectedHasMixedCurrencies, statuses),
            trend, properties, statuses, options);
    }
}
