using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Announcements;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AdminAnnouncementService(
    KoochDbContext context, IPermissionService permissions, INotificationService notifications)
{
    public async Task<PagedResult<AdminAnnouncementRecipientOption>> SearchRecipientsAsync(
        int actorUserId, AdminAnnouncementRecipientSearchQuery query,
        CancellationToken cancellationToken = default)
    {
        await RequirePermissionAsync(actorUserId, cancellationToken);
        if (query.Target is not (AdminAnnouncementTarget.SelectedAdmins or
            AdminAnnouncementTarget.SelectedPropertyOwners))
            throw new ArgumentException("A selected-recipient target is required.", nameof(query));
        if (query.Page < 1 || query.PageSize is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(query));
        var search = query.Search?.Trim();
        if (search?.Length > 200)
            throw new ArgumentException("Search is too long.", nameof(query));

        var users = EligibleRecipientUsers(query.Target);
        if (!string.IsNullOrEmpty(search))
            users = users.Where(user => user.FirstName.Contains(search) ||
                user.LastName.Contains(search) ||
                (user.FirstName + " " + user.LastName).Contains(search));
        var totalCount = await users.CountAsync(cancellationToken);
        var items = await users.OrderBy(user => user.LastName)
            .ThenBy(user => user.FirstName).ThenBy(user => user.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .Select(user => new AdminAnnouncementRecipientOption(
                user.Id, (user.FirstName + " " + user.LastName).Trim()))
            .ToArrayAsync(cancellationToken);
        return new PagedResult<AdminAnnouncementRecipientOption>
        {
            Items = items,
            TotalCount = totalCount,
            Page = query.Page,
            PageSize = query.PageSize,
            TotalPages = (int)Math.Ceiling(totalCount / (double)query.PageSize)
        };
    }

    public async Task<IReadOnlyList<AdminAnnouncementResponse>> ListAsync(
        int actorUserId, CancellationToken cancellationToken = default)
    {
        await RequirePermissionAsync(actorUserId, cancellationToken);
        var announcements = await context.AdminAnnouncements.AsNoTracking()
            .Include(row => row.Recipients)
            .OrderByDescending(row => row.SentAtUtc).ThenByDescending(row => row.Id)
            .ToListAsync(cancellationToken);
        return announcements.Select(Map).ToArray();
    }

    public async Task<AdminAnnouncementResponse> GetAsync(
        int actorUserId, int id, CancellationToken cancellationToken = default)
    {
        await RequirePermissionAsync(actorUserId, cancellationToken);
        var announcement = await context.AdminAnnouncements.AsNoTracking()
            .Include(row => row.Recipients)
            .SingleOrDefaultAsync(row => row.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Admin announcement not found.");
        return Map(announcement);
    }

    public async Task<AdminAnnouncementResponse> SendAsync(
        int actorUserId, SendAdminAnnouncementRequest request, CancellationToken cancellationToken = default)
    {
        await RequirePermissionAsync(actorUserId, cancellationToken);
        var title = Required(request.Title, 200, nameof(request.Title));
        var body = Required(request.Body, 4000, nameof(request.Body));
        var key = Required(request.IdempotencyKey, 200, nameof(request.IdempotencyKey));
        if (!Enum.IsDefined(request.Target))
            throw new ArgumentOutOfRangeException(nameof(request.Target));
        var selectedIds = (request.RecipientUserIds ?? []).Distinct().Order().ToArray();
        var selectedTarget = request.Target is AdminAnnouncementTarget.SelectedAdmins or
            AdminAnnouncementTarget.SelectedPropertyOwners;
        if (selectedTarget ? selectedIds.Length == 0 : selectedIds.Length != 0)
            throw new ArgumentException("Selected targets require user IDs; all-user targets must omit them.");
        if (selectedIds.Any(id => id <= 0))
            throw new ArgumentException("Recipient user IDs must be positive.");
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { title, body, request.Target, selectedIds }))));

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;
        if (context.Database.IsSqlServer())
        {
            var resource = $"Kooch:AdminAnnouncement:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))}";
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock
                    @Resource = {resource}, @LockMode = 'Exclusive',
                    @LockOwner = 'Transaction', @LockTimeout = 10000;
                IF @result < 0
                    THROW 51000, 'Could not acquire the announcement idempotency lock.', 1;
                """, cancellationToken);
        }

        var existing = await context.AdminAnnouncements.AsNoTracking()
            .Include(row => row.Recipients)
            .SingleOrDefaultAsync(row => row.IdempotencyKey == key, cancellationToken);
        if (existing is not null)
        {
            if (existing.SenderUserId != actorUserId || existing.RequestFingerprint != fingerprint)
                throw new InvalidOperationException("The idempotency key belongs to a different announcement.");
            return Map(existing);
        }

        var recipientIds = await ResolveRecipientsAsync(request.Target, selectedIds, cancellationToken);
        var announcement = new AdminAnnouncement
        {
            SenderUserId = actorUserId,
            CreatedByUserId = actorUserId,
            Title = title,
            Body = body,
            Target = request.Target,
            SentAtUtc = DateTime.UtcNow,
            IdempotencyKey = key,
            RequestFingerprint = fingerprint,
            Recipients = recipientIds.Select(id => new AdminAnnouncementRecipient
            {
                UserId = id, CreatedByUserId = actorUserId
            }).ToList()
        };
        context.AdminAnnouncements.Add(announcement);
        await context.SaveChangesAsync(cancellationToken);
        foreach (var userId in recipientIds)
            await notifications.SendAsync(new NotificationRequest
            {
                EventType = NotificationEventType.AdminAnnouncement,
                RecipientUserId = userId,
                Subject = title,
                Message = body,
                DataJson = JsonSerializer.Serialize(new { announcementId = announcement.Id }),
                DedupeKey = $"admin-announcement:{announcement.Id}:recipient:{userId}",
                Channels = NotificationChannel.InApp
            }, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(announcement);
    }

    private async Task<int[]> ResolveRecipientsAsync(
        AdminAnnouncementTarget target, int[] selectedIds, CancellationToken cancellationToken)
    {
        IQueryable<int> eligible = EligibleRecipientUsers(target).Select(user => user.Id);
        if (target is AdminAnnouncementTarget.SelectedAdmins or AdminAnnouncementTarget.SelectedPropertyOwners)
            eligible = eligible.Where(id => selectedIds.Contains(id));
        var result = await eligible.Distinct().OrderBy(id => id).ToArrayAsync(cancellationToken);
        if (result.Length == 0 ||
            target is AdminAnnouncementTarget.SelectedAdmins or AdminAnnouncementTarget.SelectedPropertyOwners &&
            !result.SequenceEqual(selectedIds))
            throw new ArgumentException("One or more selected recipients are not eligible.");
        return result;
    }

    private IQueryable<User> EligibleRecipientUsers(AdminAnnouncementTarget target)
    {
        var users = context.Users.AsNoTracking().Where(user => user.IsActive);
        return target is AdminAnnouncementTarget.SelectedAdmins or AdminAnnouncementTarget.AllAdmins
            ? users.Where(user => user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant)
            : users.Where(user => context.UserPropertyAccesses.Any(access =>
                access.UserId == user.Id && access.IsActive &&
                access.Status == PropertyUserStatus.Active &&
                access.PropertyRole == PropertyUserRole.PropertyOwner &&
                !access.Property.IsDeleted));
    }

    private async Task RequirePermissionAsync(int actorUserId, CancellationToken cancellationToken)
    {
        var actorRole = await context.Users.AsNoTracking()
            .Where(user => user.Id == actorUserId && user.IsActive)
            .Select(user => (UserRole?)user.Role).SingleOrDefaultAsync(cancellationToken);
        if (actorRole is not (UserRole.SuperAdmin or UserRole.AdminAssistant) ||
            !await permissions.HasPermissionAsync(actorUserId, PermissionKey.ManageNotifications,
                cancellationToken: cancellationToken))
            throw new UnauthorizedAccessException("You cannot manage Admin announcements.");
    }

    private static AdminAnnouncementResponse Map(AdminAnnouncement row)
    {
        var ids = row.Recipients.Select(recipient => recipient.UserId).Order().ToArray();
        return new(row.Id, row.Title, row.Body, row.Target, row.SenderUserId,
            row.SentAtUtc, ids.Length, ids);
    }

    private static string Required(string? value, int limit, string name)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized) || normalized.Length > limit)
            throw new ArgumentException($"Value must be between 1 and {limit} characters.", name);
        return normalized;
    }
}
