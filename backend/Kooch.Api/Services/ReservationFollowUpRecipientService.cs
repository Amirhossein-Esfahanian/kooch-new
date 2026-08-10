using Kooch.Api.Data;
using Kooch.Api.Dtos.Notifications;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface IReservationFollowUpRecipientService
{
    Task<IReadOnlyList<ReservationFollowUpRecipientResponse>> GetAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ReservationFollowUpCandidateResponse>> SearchCandidatesAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        string? search,
        CancellationToken cancellationToken = default);

    Task<ReservationFollowUpRecipientResponse> AssignAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default);

    Task DeactivateAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default);
}

public sealed class ReservationFollowUpRecipientService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IPropertyAuthorizationService propertyAuthorizationService,
    IReservationNotificationRecipientResolver recipientResolver)
    : IReservationFollowUpRecipientService
{
    public async Task<IReadOnlyList<ReservationFollowUpRecipientResponse>> GetAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(actorUserId, actorRole, propertyId, cancellationToken);
        return await ProjectAssignments(propertyId)
            .OrderBy(recipient => recipient.FullName)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ReservationFollowUpCandidateResponse>> SearchCandidatesAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        string? search,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(actorUserId, actorRole, propertyId, cancellationToken);
        var normalizedSearch = search?.Trim();
        if (normalizedSearch?.Length > 100)
        {
            throw new ArgumentException("Search text must be 100 characters or fewer.");
        }

        var assignedIds = await dbContext.PropertyReservationFollowUpRecipients.AsNoTracking()
            .Where(recipient => recipient.PropertyId == propertyId && recipient.IsActive)
            .Select(recipient => recipient.UserId)
            .ToListAsync(cancellationToken);
        var query = dbContext.Users.AsNoTracking()
            .Where(user =>
                user.IsActive &&
                !assignedIds.Contains(user.Id) &&
                (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant));
        if (!string.IsNullOrWhiteSpace(normalizedSearch))
        {
            query = query.Where(user =>
                user.FirstName.Contains(normalizedSearch) ||
                user.LastName.Contains(normalizedSearch) ||
                (user.Email != null && user.Email.Contains(normalizedSearch)) ||
                (user.PhoneNumber != null && user.PhoneNumber.Contains(normalizedSearch)));
        }

        var candidates = await query
            .OrderBy(user => user.LastName)
            .ThenBy(user => user.FirstName)
            .Take(50)
            .Select(user => new ReservationFollowUpCandidateResponse
            {
                UserId = user.Id,
                FullName = (user.FirstName + " " + user.LastName).Trim(),
                Email = user.Email,
                PhoneNumber = user.PhoneNumber
            })
            .ToListAsync(cancellationToken);
        var eligible = new List<ReservationFollowUpCandidateResponse>();
        foreach (var candidate in candidates)
        {
            if (await recipientResolver.IsEligibleFollowUpRecipientAsync(
                    propertyId,
                    candidate.UserId,
                    cancellationToken))
            {
                eligible.Add(candidate);
            }
        }

        return eligible;
    }

    public async Task<ReservationFollowUpRecipientResponse> AssignAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(actorUserId, actorRole, propertyId, cancellationToken);
        if (!await recipientResolver.IsEligibleFollowUpRecipientAsync(
                propertyId,
                userId,
                cancellationToken))
        {
            throw new ArgumentException(
                "The selected user is not eligible to follow up this property's reservations.");
        }

        var existing = await dbContext.PropertyReservationFollowUpRecipients
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(recipient =>
                    recipient.PropertyId == propertyId && recipient.UserId == userId,
                cancellationToken);
        if (existing?.IsActive == true && !existing.IsDeleted)
        {
            throw new InvalidOperationException("The selected user is already assigned.");
        }

        if (existing is null)
        {
            existing = new PropertyReservationFollowUpRecipient
            {
                PropertyId = propertyId,
                UserId = userId,
                IsActive = true,
                CreatedByUserId = actorUserId
            };
            dbContext.PropertyReservationFollowUpRecipients.Add(existing);
        }
        else
        {
            existing.IsDeleted = false;
            existing.DeletedAtUtc = null;
            existing.DeletedByUserId = null;
            existing.IsActive = true;
            existing.UpdatedByUserId = actorUserId;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return await ProjectAssignments(propertyId)
            .SingleAsync(recipient => recipient.UserId == userId, cancellationToken);
    }

    public async Task DeactivateAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageAsync(actorUserId, actorRole, propertyId, cancellationToken);
        var assignment = await dbContext.PropertyReservationFollowUpRecipients
            .SingleOrDefaultAsync(recipient =>
                    recipient.PropertyId == propertyId &&
                    recipient.UserId == userId &&
                    recipient.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Reservation follow-up assignment was not found.");
        assignment.IsActive = false;
        assignment.UpdatedByUserId = actorUserId;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private IQueryable<ReservationFollowUpRecipientResponse> ProjectAssignments(int propertyId) =>
        dbContext.PropertyReservationFollowUpRecipients.AsNoTracking()
            .Where(recipient => recipient.PropertyId == propertyId && recipient.IsActive)
            .Select(recipient => new ReservationFollowUpRecipientResponse
            {
                UserId = recipient.UserId,
                FullName = (recipient.User.FirstName + " " + recipient.User.LastName).Trim(),
                Email = recipient.User.Email,
                PhoneNumber = recipient.User.PhoneNumber,
                IsActive = recipient.User.IsActive
            });

    private async Task EnsureCanManageAsync(
        int actorUserId,
        UserRole actorRole,
        int propertyId,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        var canManagePlatformProperties = actorRole == UserRole.SuperAdmin ||
            actorRole == UserRole.AdminAssistant &&
            await permissionService.HasPermissionAsync(
                actorUserId,
                PermissionKey.ManageProperties,
                cancellationToken: cancellationToken);
        if (!canManagePlatformProperties ||
            !await propertyAuthorizationService.HasPropertyPermissionAsync(
                actorUserId,
                propertyId,
                "property.edit",
                cancellationToken))
        {
            throw new UnauthorizedAccessException(
                "You cannot manage reservation follow-up recipients for this property.");
        }
    }
}
