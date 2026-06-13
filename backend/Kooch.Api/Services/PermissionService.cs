using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PermissionService(KoochDbContext dbContext) : IPermissionService
{
    public async Task<bool> HasPermissionAsync(
        int userId,
        PermissionKey permissionKey,
        int? propertyId = null,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => new { user.Role })
            .SingleOrDefaultAsync(cancellationToken);

        if (user is null)
        {
            return false;
        }

        if (user.Role == UserRole.SuperAdmin)
        {
            return true;
        }

        var hasDirectPermission = await dbContext.UserPermissions.AsNoTracking()
            .AnyAsync(permission =>
                permission.UserId == userId &&
                permission.PermissionKey == permissionKey &&
                permission.IsAllowed &&
                (permission.PropertyId == null || permission.PropertyId == propertyId),
                cancellationToken);

        if (hasDirectPermission || propertyId is null)
        {
            return hasDirectPermission;
        }

        var propertyAccess = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.UserId == userId &&
                access.PropertyId == propertyId &&
                access.IsActive)
            .Select(access => new
            {
                access.CanManageProperty,
                access.CanManageAvailability,
                access.CanManageReservations,
                access.CanManagePayments,
                access.CanManageReviews,
                access.CanManageNotifications,
                access.CanViewReports
            })
            .SingleOrDefaultAsync(cancellationToken);

        return propertyAccess is not null && permissionKey switch
        {
            PermissionKey.ManageProperties => propertyAccess.CanManageProperty,
            PermissionKey.ManageAvailability => propertyAccess.CanManageAvailability,
            PermissionKey.ManageReservations => propertyAccess.CanManageReservations,
            PermissionKey.ManagePayments => propertyAccess.CanManagePayments,
            PermissionKey.ManageReviews => propertyAccess.CanManageReviews,
            PermissionKey.ManageNotifications => propertyAccess.CanManageNotifications,
            PermissionKey.ViewReports => propertyAccess.CanViewReports,
            _ => false
        };
    }
}
