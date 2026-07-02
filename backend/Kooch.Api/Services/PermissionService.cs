using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Kooch.Api.Services;

public class PermissionService(KoochDbContext dbContext) : IPermissionService
{
    public async Task<bool> CanAsync(
        int userId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken = default)
    {
        var normalizedKey = NormalizePermissionKey(permissionKey);
        if (normalizedKey is null)
        {
            return false;
        }

        var user = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => new { user.Role })
            .SingleOrDefaultAsync(cancellationToken);

        if (user is null)
        {
            return false;
        }

        if (user.Role is UserRole.SuperAdmin or UserRole.AdminAssistant)
        {
            return true;
        }

        if (user.Role == UserRole.Owner &&
            await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == userId, cancellationToken))
        {
            return true;
        }

        var permissionMatrixJson = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.UserId == userId &&
                access.PropertyId == propertyId &&
                access.IsActive &&
                access.Status == PropertyUserStatus.Active)
            .Select(access => access.PermissionMatrixJson)
            .SingleOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(permissionMatrixJson))
        {
            return false;
        }

        var matrix = DeserializeMatrix(permissionMatrixJson);
        return matrix.TryGetValue(normalizedKey.Value.Group, out var actions) &&
               normalizedKey.Value.Action switch
               {
                   "view" => actions.View,
                   "create" => actions.Create,
                   "edit" => actions.Edit,
                   "delete" => actions.Delete,
                   "export" => actions.Export,
                   _ => false
               };
    }

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

        var permissionKeys = LegacyPermissionMap(permissionKey);
        foreach (var key in permissionKeys)
        {
            if (await CanAsync(userId, propertyId.Value, key, cancellationToken))
            {
                return true;
            }
        }

        return false;
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

    private static Dtos.PropertyUsers.PermissionMatrixDto DeserializeMatrix(string value)
    {
        try
        {
            return JsonSerializer.Deserialize<Dtos.PropertyUsers.PermissionMatrixDto>(
                    value,
                    JsonOptions) ??
                [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static (string Group, string Action)? NormalizePermissionKey(string permissionKey)
    {
        var parts = permissionKey.Trim().ToLowerInvariant().Split('.', 2);
        if (parts.Length != 2) return null;

        var group = parts[0] switch
        {
            "dashboard" => "Dashboard",
            "property" => "Properties",
            "properties" => "Properties",
            "rooms" => "Rooms",
            "pricing" => "Pricing",
            "inventory" => "Inventory",
            "bookings" => "Bookings",
            "booking" => "Bookings",
            "reviews" => "Reviews",
            "users" => "Users",
            "financial" => "Financial",
            "reports" => "Reports",
            "settings" => "Settings",
            _ => null
        };
        if (group is null) return null;

        var action = parts[1] switch
        {
            "cancel" => "delete",
            "reply" => "edit",
            _ => parts[1]
        };
        return action is "view" or "create" or "edit" or "delete" or "export"
            ? (group, action)
            : null;
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

    private static IReadOnlyList<string> LegacyPermissionMap(PermissionKey permissionKey) =>
        permissionKey switch
        {
            PermissionKey.ManageUsers => ["users.view", "users.edit"],
            PermissionKey.ManageStaff => ["users.view", "users.edit"],
            PermissionKey.ManageProperties => ["property.view", "property.edit"],
            PermissionKey.ManageAvailability => ["inventory.view", "inventory.edit"],
            PermissionKey.ManageReservations => ["bookings.view", "bookings.edit"],
            PermissionKey.ManagePayments => ["financial.view", "financial.edit"],
            PermissionKey.ManageReviews => ["reviews.view", "reviews.reply", "reviews.edit"],
            PermissionKey.ManageSeo => ["settings.view", "settings.edit"],
            PermissionKey.ManageNotifications => ["dashboard.view"],
            PermissionKey.ViewReports => ["reports.view"],
            PermissionKey.ManageSettings => ["settings.view", "settings.edit"],
            PermissionKey.ManageRoles => ["users.view", "users.edit"],
            _ => []
        };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
}
