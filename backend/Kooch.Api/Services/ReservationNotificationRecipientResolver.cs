using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed record ReservationNotificationRecipient(
    int UserId,
    string FullName,
    string? Mobile,
    string? Email,
    bool IsPlatformFollowUp);

public interface IReservationNotificationRecipientResolver
{
    Task<IReadOnlyList<ReservationNotificationRecipient>> ResolveAsync(
        int propertyId,
        CancellationToken cancellationToken = default);

    Task<bool> IsEligibleFollowUpRecipientAsync(
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default);
}

public sealed class ReservationNotificationRecipientResolver(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IPropertyAuthorizationService propertyAuthorizationService)
    : IReservationNotificationRecipientResolver
{
    public async Task<IReadOnlyList<ReservationNotificationRecipient>> ResolveAsync(
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        var propertyUserIds = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.PropertyId == propertyId &&
                access.IsActive &&
                access.Status == PropertyUserStatus.Active &&
                access.User.IsActive)
            .Select(access => access.UserId)
            .ToListAsync(cancellationToken);
        var ownerId = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Id == propertyId)
            .Select(property => (int?)property.OwnerId)
            .SingleOrDefaultAsync(cancellationToken);
        if (!ownerId.HasValue)
        {
            throw new KeyNotFoundException("Property not found.");
        }

        propertyUserIds.Add(ownerId.Value);
        var propertyRecipientIds = new List<int>();
        foreach (var userId in propertyUserIds.Distinct())
        {
            if (await propertyAuthorizationService.HasPropertyPermissionAsync(
                    userId,
                    propertyId,
                    "bookings.edit",
                    cancellationToken))
            {
                propertyRecipientIds.Add(userId);
            }
        }

        var followUpIds = await dbContext.PropertyReservationFollowUpRecipients.AsNoTracking()
            .Where(recipient => recipient.PropertyId == propertyId && recipient.IsActive)
            .Select(recipient => recipient.UserId)
            .ToListAsync(cancellationToken);
        var eligibleFollowUpIds = new List<int>();
        foreach (var userId in followUpIds.Distinct())
        {
            if (await IsEligibleFollowUpRecipientAsync(propertyId, userId, cancellationToken))
            {
                eligibleFollowUpIds.Add(userId);
            }
        }

        var allIds = propertyRecipientIds.Concat(eligibleFollowUpIds).Distinct().ToArray();
        var users = await dbContext.Users.AsNoTracking()
            .Where(user => allIds.Contains(user.Id) && user.IsActive)
            .OrderBy(user => user.LastName)
            .ThenBy(user => user.FirstName)
            .Select(user => new
            {
                user.Id,
                user.FirstName,
                user.LastName,
                user.PhoneNumber,
                user.Email
            })
            .ToListAsync(cancellationToken);
        var followUpSet = eligibleFollowUpIds.ToHashSet();
        return users.Select(user => new ReservationNotificationRecipient(
                user.Id,
                $"{user.FirstName} {user.LastName}".Trim(),
                user.PhoneNumber,
                user.Email,
                followUpSet.Contains(user.Id) && !propertyRecipientIds.Contains(user.Id)))
            .ToList();
    }

    public async Task<bool> IsEligibleFollowUpRecipientAsync(
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        var role = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => (UserRole?)user.Role)
            .SingleOrDefaultAsync(cancellationToken);
        if (role is not (UserRole.SuperAdmin or UserRole.AdminAssistant))
        {
            return false;
        }

        return await permissionService.HasPermissionAsync(
                   userId,
                   PermissionKey.ManageReservations,
                   cancellationToken: cancellationToken) &&
               await propertyAuthorizationService.HasPropertyPermissionAsync(
                   userId,
                   propertyId,
                   "bookings.edit",
                   cancellationToken);
    }
}
