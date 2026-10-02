using Kooch.Api.Data;
using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Dtos.Reservations;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AccountNotificationInboxService(KoochDbContext context)
{
    public async Task<PagedResult<NotificationInboxItemResponse>> ListAsync(
        int userId, NotificationInboxQuery query, CancellationToken cancellationToken = default)
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 50);
        var notifications = context.NotificationLogs.AsNoTracking()
            .Where(log => log.RecipientUserId == userId);
        var totalCount = await notifications.CountAsync(cancellationToken);
        var items = await notifications
            .OrderByDescending(log => log.CreatedAtUtc)
            .ThenByDescending(log => log.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(log => new NotificationInboxItemResponse
            {
                Id = log.Id,
                EventType = log.EventType,
                Subject = log.Subject,
                Message = log.Message,
                CreatedAtUtc = log.CreatedAtUtc,
                ReadAtUtc = log.ReadAtUtc,
                IsRead = log.ReadAtUtc != null,
                ReservationNumber = log.Reservation == null ? null : log.Reservation.ReservationNumber,
                PropertyId = log.PropertyId
            })
            .ToListAsync(cancellationToken);
        return new PagedResult<NotificationInboxItemResponse>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    public Task<int> UnreadCountAsync(int userId, CancellationToken cancellationToken = default) =>
        context.NotificationLogs.AsNoTracking()
            .CountAsync(log => log.RecipientUserId == userId && log.ReadAtUtc == null, cancellationToken);

    public async Task MarkReadAsync(int userId, int notificationId, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var updated = await context.NotificationLogs
            .Where(log => log.Id == notificationId && log.RecipientUserId == userId && log.ReadAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(log => log.ReadAtUtc, now)
                .SetProperty(log => log.UpdatedAtUtc, now), cancellationToken);
        if (updated != 0) return;
        if (!await context.NotificationLogs.AsNoTracking()
                .AnyAsync(log => log.Id == notificationId && log.RecipientUserId == userId, cancellationToken))
            throw new KeyNotFoundException("Notification not found.");
    }

    public Task<int> MarkAllReadAsync(int userId, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        return context.NotificationLogs
            .Where(log => log.RecipientUserId == userId && log.ReadAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(log => log.ReadAtUtc, now)
                .SetProperty(log => log.UpdatedAtUtc, now), cancellationToken);
    }
}
