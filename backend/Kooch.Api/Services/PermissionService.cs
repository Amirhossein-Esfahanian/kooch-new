using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PermissionService(
    KoochDbContext dbContext,
    IPropertyAuthorizationService propertyAuthorizationService) : IPermissionService
{
    public Task<bool> CanAsync(
        int userId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken = default) =>
        propertyAuthorizationService.HasPropertyPermissionAsync(
            userId,
            propertyId,
            permissionKey,
            cancellationToken);

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

        if (propertyId.HasValue)
        {
            foreach (var key in PropertyPermissionMap(permissionKey))
            {
                if (await propertyAuthorizationService.HasPropertyPermissionAsync(
                        userId,
                        propertyId.Value,
                        key,
                        cancellationToken))
                {
                    return true;
                }
            }

            return false;
        }

        return await dbContext.UserPermissions.AsNoTracking()
            .AnyAsync(permission =>
                permission.UserId == userId &&
                permission.PermissionKey == permissionKey &&
                permission.IsAllowed,
                cancellationToken);
    }

    public static IReadOnlyList<string> MatrixToKeys(IReadOnlyDictionary<string, Dtos.PropertyUsers.PermissionActionsDto> matrix)
    {
        var keys = new List<string>();
        foreach (var (group, actions) in matrix)
        {
            var groupKey = GroupToPermissionSegment(group);
            if (groupKey is null) continue;

            if (actions.View) keys.Add($"{groupKey}.view");
            if (actions.Create) keys.Add($"{groupKey}.create");
            if (actions.Edit) keys.Add($"{groupKey}.edit");
            if (actions.Delete) keys.Add(groupKey == "bookings" ? "bookings.cancel" : $"{groupKey}.delete");
            if (actions.Export) keys.Add($"{groupKey}.export");
        }
        return keys;
    }

    private static string? GroupToPermissionSegment(string group) =>
        group switch
        {
            "Dashboard" => "dashboard",
            "Properties" => "property",
            "Rooms" => "rooms",
            "Pricing" => "pricing",
            "Inventory" => "inventory",
            "Bookings" => "bookings",
            "Reviews" => "reviews",
            "Users" => "users",
            "Financial" => "financial",
            "Reports" => "reports",
            "Settings" => "settings",
            _ => null
        };

    private static IReadOnlyList<string> PropertyPermissionMap(PermissionKey permissionKey) =>
        permissionKey switch
        {
            PermissionKey.ManageUsers => ["users.view", "users.edit"],
            PermissionKey.ManageStaff => ["users.view", "users.edit"],
            PermissionKey.ManageRoles => ["users.view", "users.edit"],
            PermissionKey.ManageProperties => ["property.view", "property.edit"],
            PermissionKey.ManageRooms => ["rooms.view", "rooms.edit"],
            PermissionKey.ManagePricing => ["pricing.view", "pricing.edit"],
            PermissionKey.ManageAvailability => ["inventory.view", "inventory.edit"],
            PermissionKey.ManageReservations => ["bookings.view", "bookings.edit"],
            PermissionKey.ManagePayments => ["financial.view", "financial.edit"],
            PermissionKey.ManageReviews => ["reviews.view", "reviews.reply", "reviews.edit"],
            PermissionKey.ManageSeo => ["settings.view", "settings.edit"],
            PermissionKey.ManageNotifications => ["dashboard.view"],
            PermissionKey.ViewReports => ["reports.view"],
            PermissionKey.ManageSettings => ["settings.view", "settings.edit"],
            PermissionKey.ViewDashboard => ["dashboard.view"],
            PermissionKey.ManageGuests => ["bookings.view", "bookings.edit"],
            PermissionKey.ManageAmenities => ["property.view", "property.edit"],
            PermissionKey.ManagePromotions => ["pricing.view", "pricing.edit"],
            _ => []
        };

}
