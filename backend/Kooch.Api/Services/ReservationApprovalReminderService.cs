using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

internal interface IReservationApprovalReminderService
{
    Task<int> ProcessDueAsync(
        DateTime nowUtc,
        int batchSize,
        CancellationToken cancellationToken = default);
}

internal sealed class ReservationApprovalReminderService(
    KoochDbContext dbContext,
    IReservationNotificationDispatcher notificationDispatcher)
    : IReservationApprovalReminderService
{
    public async Task<int> ProcessDueAsync(
        DateTime nowUtc,
        int batchSize,
        CancellationToken cancellationToken = default)
    {
        if (batchSize <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(batchSize));
        }

        var intervalMinutes = await ReservationOwnerApprovalReminderSettings.GetMinutesAsync(
            dbContext,
            cancellationToken);
        var interval = TimeSpan.FromMinutes(intervalMinutes);
        var earliestEligibleCreation = nowUtc - interval;
        var reservationIds = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                reservation.Status == ReservationStatus.PendingApproval &&
                reservation.ApprovalExpiresAtUtc.HasValue &&
                reservation.ApprovalExpiresAtUtc.Value > nowUtc &&
                reservation.CreatedAtUtc <= earliestEligibleCreation)
            .OrderBy(reservation => reservation.ApprovalExpiresAtUtc)
            .ThenBy(reservation => reservation.Id)
            .Select(reservation => reservation.Id)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        var sentCount = 0;
        foreach (var reservationId in reservationIds)
        {
            if (await TryProcessAsync(
                    reservationId,
                    nowUtc,
                    intervalMinutes,
                    interval,
                    cancellationToken))
            {
                sentCount++;
            }
        }

        return sentCount;
    }

    private async Task<bool> TryProcessAsync(
        int reservationId,
        DateTime nowUtc,
        int intervalMinutes,
        TimeSpan interval,
        CancellationToken cancellationToken)
    {
        var reservation = await dbContext.Reservations.AsNoTracking()
            .Where(item =>
                item.Id == reservationId &&
                item.Status == ReservationStatus.PendingApproval &&
                item.ApprovalExpiresAtUtc.HasValue &&
                item.ApprovalExpiresAtUtc.Value > nowUtc)
            .Select(item => new { item.Id, item.CreatedAtUtc })
            .SingleOrDefaultAsync(cancellationToken);
        if (reservation is null)
        {
            return false;
        }

        var occurrence = (nowUtc - reservation.CreatedAtUtc).Ticks / interval.Ticks;
        if (occurrence < 1)
        {
            return false;
        }

        var occurrenceKey = $"i{intervalMinutes}:b{occurrence}";
        var approvalNotifications = await dbContext.NotificationLogs.AsNoTracking()
            .Where(log =>
                log.ReservationId == reservationId &&
                (log.EventType == NotificationEventType.ReservationApprovalRequested ||
                 log.EventType == NotificationEventType.ReservationApprovalReminder))
            .Select(log => new { log.EventType, log.CreatedAtUtc, log.DedupeKey })
            .ToListAsync(cancellationToken);
        var lastApprovalNotificationAtUtc = approvalNotifications.Count == 0
            ? reservation.CreatedAtUtc
            : approvalNotifications.Max(log => log.CreatedAtUtc);
        var currentOccurrenceStarted = approvalNotifications.Any(log =>
            log.EventType == NotificationEventType.ReservationApprovalReminder &&
            log.DedupeKey != null &&
            log.DedupeKey.Contains($":approval-reminder:{occurrenceKey}:"));
        if (!currentOccurrenceStarted && lastApprovalNotificationAtUtc + interval > nowUtc)
        {
            return false;
        }

        return await notificationDispatcher.NotifyApprovalReminderAsync(
            reservation.Id,
            nowUtc,
            occurrenceKey,
            cancellationToken);
    }
}
