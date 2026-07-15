using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyAccessService(KoochDbContext dbContext)
    : IPropertyAccessService, IPropertyAuthorizationService
{
    public async Task<bool> CanAccessPropertyAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        await GetEffectivePropertyPermissionsAsync(userId, propertyId, cancellationToken) is not null;

    public async Task<bool> CanAccessOwnerPanelAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.AsNoTracking()
            .Where(item => item.Id == userId && item.IsActive)
            .Select(item => new { item.Role })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return false;
        }

        if (user.Role == UserRole.SuperAdmin)
        {
            return true;
        }

        var propertyIds = await GetMembershipPropertyIdsAsync(userId, cancellationToken);
        foreach (var propertyId in propertyIds)
        {
            if (await GetEffectivePropertyPermissionsAsync(userId, propertyId, cancellationToken) is not null)
            {
                return true;
            }
        }

        return false;
    }

    public async Task<bool> HasPropertyPermissionAsync(
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

        var effective = await GetEffectivePropertyPermissionsAsync(userId, propertyId, cancellationToken);
        if (effective is null)
        {
            return false;
        }

        if (effective.IsSuperAdminBypass)
        {
            return true;
        }

        return effective.PermissionMatrix.TryGetValue(normalizedKey.Value.Group, out var actions) &&
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

    public async Task<EffectivePropertyPermissions?> GetEffectivePropertyPermissionsAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.AsNoTracking()
            .Where(item => item.Id == userId && item.IsActive)
            .Select(item => new { item.Role })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return null;
        }

        var propertyExists = await dbContext.Properties.AsNoTracking()
            .AnyAsync(property => property.Id == propertyId, cancellationToken);
        if (!propertyExists)
        {
            return null;
        }

        if (user.Role == UserRole.SuperAdmin)
        {
            return new EffectivePropertyPermissions(
                propertyId,
                null,
                PropertyPermissionMatrixDefaults.CreateOwner(),
                IsSuperAdminBypass: true);
        }

        var membership = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.UserId == userId &&
                access.PropertyId == propertyId &&
                access.IsActive &&
                access.Status == PropertyUserStatus.Active)
            .Select(access => new
            {
                access.PropertyRole,
                access.PermissionMatrixJson,
                access.Property.OwnerId
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (membership is null)
        {
            return null;
        }

        var isPropertyOwnerMembership = membership.PropertyRole == PropertyUserRole.PropertyOwner;
        if (isPropertyOwnerMembership != (membership.OwnerId == userId))
        {
            return null;
        }

        var matrix = DeserializeCanonicalMatrix(membership.PermissionMatrixJson);
        if (matrix is null)
        {
            return null;
        }

        if (user.Role == UserRole.AdminAssistant)
        {
            var platformPermissions = await dbContext.UserPermissions.AsNoTracking()
                .Where(permission =>
                    permission.UserId == userId &&
                    permission.PropertyId == null &&
                    permission.IsAllowed)
                .Select(permission => permission.PermissionKey)
                .ToHashSetAsync(cancellationToken);
            matrix = ApplyPlatformPermissionLimits(matrix, platformPermissions);
            if (!matrix.Values.Any(HasAnyAction))
            {
                return null;
            }
        }

        return new EffectivePropertyPermissions(
            propertyId,
            membership.PropertyRole,
            matrix,
            IsSuperAdminBypass: false);
    }

    public async Task<IReadOnlyList<int>> GetAccessiblePropertiesAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.AsNoTracking()
            .Where(item => item.Id == userId && item.IsActive)
            .Select(item => new { item.Role })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return [];
        }

        if (user.Role == UserRole.SuperAdmin)
        {
            return await dbContext.Properties.AsNoTracking()
                .OrderBy(property => property.Id)
                .Select(property => property.Id)
                .ToListAsync(cancellationToken);
        }

        var propertyIds = await GetMembershipPropertyIdsAsync(userId, cancellationToken);
        var accessiblePropertyIds = new List<int>();
        foreach (var propertyId in propertyIds)
        {
            if (await GetEffectivePropertyPermissionsAsync(userId, propertyId, cancellationToken) is not null)
            {
                accessiblePropertyIds.Add(propertyId);
            }
        }

        return accessiblePropertyIds;
    }

    public async Task<bool> CanViewAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        await HasAnyPropertyPermissionAsync(
            userId,
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
        HasPropertyPermissionAsync(userId, propertyId, "property.edit", cancellationToken);

    public Task<bool> CanManageRoomsAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasAnyPropertyPermissionAsync(
            userId,
            propertyId,
            ["rooms.create", "rooms.edit", "rooms.delete"],
            cancellationToken);

    public Task<bool> CanManageAvailabilityAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasPropertyPermissionAsync(userId, propertyId, "inventory.edit", cancellationToken);

    public Task<bool> CanManagePricingAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default) =>
        HasPropertyPermissionAsync(userId, propertyId, "pricing.edit", cancellationToken);

    private async Task<bool> HasAnyPropertyPermissionAsync(
        int userId,
        int propertyId,
        IReadOnlyCollection<string> permissionKeys,
        CancellationToken cancellationToken)
    {
        foreach (var permissionKey in permissionKeys)
        {
            if (await HasPropertyPermissionAsync(userId, propertyId, permissionKey, cancellationToken))
            {
                return true;
            }
        }

        return false;
    }

    private async Task<List<int>> GetMembershipPropertyIdsAsync(
        int userId,
        CancellationToken cancellationToken) =>
        await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                access.UserId == userId &&
                access.IsActive &&
                access.Status == PropertyUserStatus.Active)
            .OrderBy(access => access.PropertyId)
            .Select(access => access.PropertyId)
            .ToListAsync(cancellationToken);

    private static PermissionMatrixDto? DeserializeCanonicalMatrix(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            var matrix = JsonSerializer.Deserialize<PermissionMatrixDto>(value, JsonOptions);
            return matrix is not null &&
                   matrix.Count > 0 &&
                   matrix.All(item => PropertyPermissionMatrixDefaults.Groups.Contains(item.Key) && item.Value is not null)
                ? matrix
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static PermissionMatrixDto ApplyPlatformPermissionLimits(
        PermissionMatrixDto matrix,
        IReadOnlySet<PermissionKey> platformPermissions)
    {
        var effective = new PermissionMatrixDto();
        foreach (var (group, actions) in matrix)
        {
            var requiredPermission = PlatformPermissionForGroup(group);
            effective[group] = requiredPermission.HasValue && platformPermissions.Contains(requiredPermission.Value)
                ? actions
                : new PermissionActionsDto();
        }

        return effective;
    }

    private static PermissionKey? PlatformPermissionForGroup(string group) =>
        group switch
        {
            "Dashboard" => PermissionKey.ViewDashboard,
            "Properties" => PermissionKey.ManageProperties,
            "Rooms" => PermissionKey.ManageRooms,
            "Pricing" => PermissionKey.ManagePricing,
            "Inventory" => PermissionKey.ManageAvailability,
            "Bookings" => PermissionKey.ManageReservations,
            "Reviews" => PermissionKey.ManageReviews,
            "Users" => PermissionKey.ManageUsers,
            "Financial" => PermissionKey.ManagePayments,
            "Reports" => PermissionKey.ViewReports,
            "Settings" => PermissionKey.ManageSettings,
            _ => null
        };

    private static bool HasAnyAction(PermissionActionsDto actions) =>
        actions.View || actions.Create || actions.Edit || actions.Delete || actions.Export;

    private static (string Group, string Action)? NormalizePermissionKey(string permissionKey)
    {
        var parts = permissionKey.Trim().ToLowerInvariant().Split('.', 2);
        if (parts.Length != 2)
        {
            return null;
        }

        var group = parts[0] switch
        {
            "dashboard" => "Dashboard",
            "property" or "properties" => "Properties",
            "rooms" => "Rooms",
            "pricing" => "Pricing",
            "inventory" => "Inventory",
            "booking" or "bookings" => "Bookings",
            "reviews" => "Reviews",
            "users" => "Users",
            "financial" => "Financial",
            "reports" => "Reports",
            "settings" => "Settings",
            _ => null
        };
        if (group is null)
        {
            return null;
        }

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

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
}
