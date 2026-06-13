using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyAccessService(
    KoochDbContext dbContext,
    IPermissionService permissionService) : IPropertyAccessService
{
    public async Task<bool> CanViewAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (await HasFullRoleAccessAsync(userId, role, propertyId, cancellationToken))
        {
            return true;
        }

        return role == UserRole.OwnerAssistant &&
               await dbContext.UserPropertyAccesses.AsNoTracking()
                   .AnyAsync(access => access.UserId == userId &&
                                       access.PropertyId == propertyId &&
                                       access.IsActive,
                       cancellationToken);
    }

    public async Task<bool> CanManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (await HasFullRoleAccessAsync(userId, role, propertyId, cancellationToken))
        {
            return true;
        }

        return role == UserRole.OwnerAssistant &&
               await dbContext.UserPropertyAccesses.AsNoTracking()
                   .AnyAsync(access => access.UserId == userId &&
                                       access.PropertyId == propertyId &&
                                       access.IsActive &&
                                       access.CanManageProperty,
                       cancellationToken);
    }

    public async Task<bool> CanManageRoomsAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (await HasFullRoleAccessAsync(userId, role, propertyId, cancellationToken))
        {
            return true;
        }

        return role == UserRole.OwnerAssistant &&
               await dbContext.UserPropertyAccesses.AsNoTracking()
                   .AnyAsync(access => access.UserId == userId &&
                                       access.PropertyId == propertyId &&
                                       access.IsActive &&
                                       access.CanManageRooms,
                       cancellationToken);
    }

    public async Task<bool> CanManagePricingAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (await HasFullRoleAccessAsync(userId, role, propertyId, cancellationToken))
        {
            return true;
        }

        return role == UserRole.OwnerAssistant &&
               await dbContext.UserPropertyAccesses.AsNoTracking()
                   .AnyAsync(access => access.UserId == userId &&
                                       access.PropertyId == propertyId &&
                                       access.IsActive &&
                                       access.CanManagePricing,
                       cancellationToken);
    }

    private async Task<bool> HasFullRoleAccessAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        if (role == UserRole.SuperAdmin)
        {
            return true;
        }

        if (role == UserRole.Owner)
        {
            return await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == userId, cancellationToken);
        }

        return role == UserRole.AdminAssistant &&
               await permissionService.HasPermissionAsync(
                   userId,
                   PermissionKey.ManageProperties,
                   propertyId,
                   cancellationToken);
    }
}
