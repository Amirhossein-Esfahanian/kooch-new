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
        CancellationToken cancellationToken = default) =>
        await HasAnyPropertyPermissionAsync(
            userId,
            role,
            propertyId,
            [
                "dashboard.view",
                "property.view",
                "rooms.view",
                "pricing.view",
                "inventory.view",
                "bookings.view",
                "reviews.view",
                "users.view",
                "financial.view",
                "reports.view",
                "settings.view"
            ],
            cancellationToken);

    public Task<bool> CanManagePropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasPropertyPermissionAsync(userId, role, propertyId, "property.edit", cancellationToken);

    public Task<bool> CanManageRoomsAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasAnyPropertyPermissionAsync(
            userId,
            role,
            propertyId,
            ["rooms.create", "rooms.edit", "rooms.delete"],
            cancellationToken);

    public Task<bool> CanManageAvailabilityAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasPropertyPermissionAsync(userId, role, propertyId, "inventory.edit", cancellationToken);

    public Task<bool> CanManagePricingAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasPropertyPermissionAsync(userId, role, propertyId, "pricing.edit", cancellationToken);

    private async Task<bool> HasAnyPropertyPermissionAsync(
        int userId,
        UserRole role,
        int propertyId,
        IReadOnlyCollection<string> permissionKeys,
        CancellationToken cancellationToken)
    {
        foreach (var permissionKey in permissionKeys)
        {
            if (await HasPropertyPermissionAsync(userId, role, propertyId, permissionKey, cancellationToken))
            {
                return true;
            }
        }

        return false;
    }

    private async Task<bool> HasPropertyPermissionAsync(
        int userId,
        UserRole role,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken)
    {
        if (role == UserRole.SuperAdmin)
        {
            return true;
        }

        if (role == UserRole.AdminAssistant)
        {
            return true;
        }

        if (role == UserRole.Owner &&
            await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == userId, cancellationToken))
        {
            return true;
        }

        return await permissionService.CanAsync(userId, propertyId, permissionKey, cancellationToken);
    }
}
