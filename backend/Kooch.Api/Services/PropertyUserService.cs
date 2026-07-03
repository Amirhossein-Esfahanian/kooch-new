using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Text.Json;

namespace Kooch.Api.Services;

public class PropertyUserService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IAuthService authService,
    IHostEnvironment appEnvironment) : IPropertyUserService
{
    public async Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, currentRole, propertyId, "users.view", cancellationToken);

        var property = await dbContext.Properties.AsNoTracking()
            .Include(item => item.Owner)
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var ownerLastActivity = await GetLastActivityAsync(propertyId, property.OwnerId, cancellationToken);
        var users = new List<PropertyUserResponse>
        {
            MapOwner(property, ownerLastActivity)
        };

        var accessUsers = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Include(access => access.User)
            .Where(access => access.PropertyId == propertyId && access.UserId != property.OwnerId)
            .OrderBy(access => access.PropertyRole)
            .ThenBy(access => access.User.LastName)
            .ThenBy(access => access.User.FirstName)
            .Select(access => new PropertyUserResponse
            {
                Id = access.Id,
                UserId = access.UserId,
                PropertyId = access.PropertyId,
                FullName = (access.User.FirstName + " " + access.User.LastName).Trim(),
                Mobile = access.User.PhoneNumber,
                Email = access.User.Email,
                Username = string.IsNullOrWhiteSpace(access.User.Username) ? access.User.Email : access.User.Username!,
                Status = access.Status,
                Role = access.PropertyRole,
                IsActive = access.IsActive && access.User.IsActive,
                PasswordSetupRequired = access.User.PasswordSetupRequired,
                CanRemove = true,
                Permissions = DeserializeMatrix(access.PermissionMatrixJson),
                CreatedAtUtc = access.User.CreatedAtUtc,
                InvitationAcceptedAtUtc = access.User.InvitationAcceptedAtUtc,
                LastActivityAtUtc = dbContext.AuditLogs
                    .Where(log => log.PropertyId == propertyId && log.UserId == access.UserId)
                    .Max(log => (DateTime?)log.OccurredAtUtc)
            })
            .ToListAsync(cancellationToken);

        users.AddRange(accessUsers);
        return users;
    }

    public async Task<PropertyUserResponse> CreateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        PropertyUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, currentRole, propertyId, "users.create", cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be created from this page.");
        }
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            currentRole,
            propertyId,
            request.Role,
            "create",
            cancellationToken);

        var invitation = new PropertyUserRequest
        {
            FullName = request.FullName,
            Mobile = request.Mobile,
            Email = request.Email,
            Username = request.Username,
            Role = request.Role,
            Status = PropertyUserStatus.Pending,
            IsActive = false,
            Permissions = request.Permissions
        };
        await EnsureCanGrantPermissionsAsync(
            currentUserId,
            currentRole,
            propertyId,
            invitation.Permissions ?? BuildDefaultMatrix(invitation.Role),
            cancellationToken);

        var propertyExists = await dbContext.Properties.AsNoTracking()
            .AnyAsync(property => property.Id == propertyId, cancellationToken);
        if (!propertyExists)
        {
            throw new KeyNotFoundException("Property not found.");
        }

        var email = NormalizeEmail(invitation.Email);
        var username = CleanOptional(invitation.Username) ?? email;
        var name = SplitFullName(invitation.FullName);
        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(item => item.Email == email, cancellationToken);

        if (user is null)
        {
            user = new User
            {
                FirstName = name.FirstName,
                LastName = name.LastName,
                Email = email,
                Username = username,
                PhoneNumber = CleanOptional(invitation.Mobile),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
                Role = UserRole.OwnerAssistant,
                ParentUserId = currentUserId,
                IsActive = false,
                PasswordSetupRequired = true
            };
            dbContext.Users.Add(user);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            await EnsureUserCanBeAssignedAsync(user.Id, propertyId, cancellationToken);
            user.FirstName = name.FirstName;
            user.LastName = name.LastName;
            user.Username = username;
            user.PhoneNumber = CleanOptional(invitation.Mobile);
            user.Role = UserRole.OwnerAssistant;
            user.IsActive = false;
            user.PasswordSetupRequired = true;
        }

        var access = await dbContext.UserPropertyAccesses
            .SingleOrDefaultAsync(item => item.UserId == user.Id && item.PropertyId == propertyId, cancellationToken);
        if (access is null)
        {
            access = new UserPropertyAccess
            {
                UserId = user.Id,
                PropertyId = propertyId
            };
            dbContext.UserPropertyAccesses.Add(access);
        }

        ApplyRequest(access, invitation);
        await dbContext.SaveChangesAsync(cancellationToken);
        var setupLink = await authService.CreatePasswordSetupTokenAsync(user.Id, cancellationToken);
        var response = (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == user.Id);
        if (appEnvironment.IsDevelopment())
        {
            response.TemporarySetupLink = setupLink;
        }
        return response;
    }

    public async Task<PropertyUserResponse> UpdateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        int userId,
        PropertyUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, currentRole, propertyId, "users.edit", cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be changed from this page.");
        }
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            currentRole,
            propertyId,
            request.Role,
            "assign",
            cancellationToken);

        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");
        if (property.OwnerId == userId)
        {
            throw new InvalidOperationException("Property owner cannot be edited as a staff user.");
        }

        var access = await dbContext.UserPropertyAccesses
            .Include(item => item.User)
            .SingleOrDefaultAsync(item => item.UserId == userId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property user not found.");
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            currentRole,
            propertyId,
            access.PropertyRole,
            "edit",
            cancellationToken);

        var email = NormalizeEmail(request.Email);
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email && user.Id != userId, cancellationToken))
        {
            throw new InvalidOperationException("An account with this email already exists.");
        }

        var name = SplitFullName(request.FullName);
        access.User.FirstName = name.FirstName;
        access.User.LastName = name.LastName;
        access.User.Email = email;
        access.User.Username = CleanOptional(request.Username) ?? email;
        access.User.PhoneNumber = CleanOptional(request.Mobile);
        access.User.IsActive = request.IsActive && request.Status == PropertyUserStatus.Active;
        await EnsureCanGrantPermissionsAsync(
            currentUserId,
            currentRole,
            propertyId,
            request.Permissions ?? BuildDefaultMatrix(request.Role),
            cancellationToken);
        ApplyRequest(access, request);

        await dbContext.SaveChangesAsync(cancellationToken);
        return (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == userId);
    }

    public async Task DeleteUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await SetStatusAsync(
            currentUserId,
            currentRole,
            propertyId,
            userId,
            PropertyUserStatus.Inactive,
            cancellationToken);
    }

    public async Task<PropertyUserResponse> SetStatusAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        int userId,
        PropertyUserStatus status,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(
            currentUserId,
            currentRole,
            propertyId,
            status == PropertyUserStatus.Inactive ? "users.delete" : "users.edit",
            cancellationToken);
        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");
        if (property.OwnerId == userId)
        {
            throw new InvalidOperationException("Property owner status cannot be changed from this page.");
        }

        var access = await dbContext.UserPropertyAccesses
            .Include(item => item.User)
            .SingleOrDefaultAsync(item => item.UserId == userId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property user not found.");
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            currentRole,
            propertyId,
            access.PropertyRole,
            "change status for",
            cancellationToken);
        access.Status = status;
        access.IsActive = status == PropertyUserStatus.Active;
        access.User.IsActive = status == PropertyUserStatus.Active;
        await dbContext.SaveChangesAsync(cancellationToken);
        return (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == userId);
    }

    private async Task EnsureCanUseUsersPermissionAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken)
    {
        var allowed = currentRole switch
        {
            UserRole.SuperAdmin => true,
            UserRole.Owner => await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == currentUserId, cancellationToken),
            UserRole.AdminAssistant => true,
            UserRole.OwnerAssistant => await permissionService.CanAsync(
                currentUserId,
                propertyId,
                permissionKey,
                cancellationToken),
            _ => false
        };

        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot manage users for this property.");
        }
    }

    private async Task EnsureCanGrantPermissionsAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        PermissionMatrixDto requestedPermissions,
        CancellationToken cancellationToken)
    {
        if (currentRole is UserRole.SuperAdmin or UserRole.AdminAssistant)
        {
            return;
        }

        if (currentRole == UserRole.Owner &&
            await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == currentUserId, cancellationToken))
        {
            return;
        }

        foreach (var permissionKey in MatrixToPermissionKeys(NormalizeMatrix(requestedPermissions)))
        {
            if (!await permissionService.CanAsync(currentUserId, propertyId, permissionKey, cancellationToken))
            {
                throw new UnauthorizedAccessException(
                    $"You cannot grant permission '{permissionKey}' because you do not have it.");
            }
        }
    }

    private async Task EnsureCanManageTargetRoleAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        PropertyUserRole targetRole,
        string action,
        CancellationToken cancellationToken)
    {
        var actorRole = await GetActorPropertyRoleAsync(currentUserId, currentRole, propertyId, cancellationToken);
        if (RoleRank(targetRole) > RoleRank(actorRole))
        {
            throw new UnauthorizedAccessException(
                $"You cannot {action} a user with a higher property role.");
        }
    }

    private async Task<PropertyUserRole> GetActorPropertyRoleAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        CancellationToken cancellationToken)
    {
        if (currentRole is UserRole.SuperAdmin or UserRole.AdminAssistant)
        {
            return PropertyUserRole.PropertyOwner;
        }

        if (currentRole == UserRole.Owner &&
            await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == currentUserId, cancellationToken))
        {
            return PropertyUserRole.PropertyOwner;
        }

        var accessRole = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access => access.UserId == currentUserId &&
                             access.PropertyId == propertyId &&
                             access.IsActive &&
                             access.Status == PropertyUserStatus.Active)
            .Select(access => (PropertyUserRole?)access.PropertyRole)
            .SingleOrDefaultAsync(cancellationToken);

        return accessRole ?? PropertyUserRole.Custom;
    }

    private static int RoleRank(PropertyUserRole role) =>
        role switch
        {
            PropertyUserRole.PropertyOwner => 100,
            PropertyUserRole.Manager => 80,
            PropertyUserRole.Accounting => 60,
            PropertyUserRole.Reception => 50,
            PropertyUserRole.Housekeeping => 40,
            PropertyUserRole.Custom => 10,
            _ => 0
        };

    private async Task EnsureUserCanBeAssignedAsync(
        int userId,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var belongsToOtherProperty = await dbContext.UserPropertyAccesses.AsNoTracking()
            .AnyAsync(access => access.UserId == userId && access.PropertyId != propertyId, cancellationToken);
        if (belongsToOtherProperty)
        {
            throw new InvalidOperationException("This user already belongs to another property.");
        }
    }

    private static PropertyUserResponse MapOwner(Property property, DateTime? lastActivityAtUtc)
    {
        var owner = property.Owner;
        return new PropertyUserResponse
        {
            Id = 0,
            UserId = property.OwnerId,
            PropertyId = property.Id,
            FullName = (owner.FirstName + " " + owner.LastName).Trim(),
            Mobile = owner.PhoneNumber,
            Email = owner.Email,
            Username = string.IsNullOrWhiteSpace(owner.Username) ? owner.Email : owner.Username!,
            Status = owner.IsActive ? PropertyUserStatus.Active : PropertyUserStatus.Suspended,
            Role = PropertyUserRole.PropertyOwner,
            IsActive = owner.IsActive,
            PasswordSetupRequired = owner.PasswordSetupRequired,
            CanRemove = false,
            Permissions = BuildOwnerMatrix(),
            CreatedAtUtc = owner.CreatedAtUtc,
            InvitationAcceptedAtUtc = owner.InvitationAcceptedAtUtc,
            LastActivityAtUtc = lastActivityAtUtc
        };
    }

    private async Task<DateTime?> GetLastActivityAsync(
        int propertyId,
        int userId,
        CancellationToken cancellationToken) =>
        await dbContext.AuditLogs.AsNoTracking()
            .Where(log => log.PropertyId == propertyId && log.UserId == userId)
            .MaxAsync(log => (DateTime?)log.OccurredAtUtc, cancellationToken);

    private static void ApplyRequest(UserPropertyAccess access, PropertyUserRequest request)
    {
        access.PropertyRole = request.Role;
        access.Status = request.Status;
        access.IsActive = request.IsActive && request.Status == PropertyUserStatus.Active;
        var permissions = NormalizeMatrix(request.Permissions ?? BuildDefaultMatrix(request.Role));
        access.PermissionMatrixJson = JsonSerializer.Serialize(permissions, JsonOptions);
        access.CanManageProperty = CanManageGroup(permissions, "Properties");
        access.CanManageRooms = CanManageGroup(permissions, "Rooms");
        access.CanManageAvailability = CanManageGroup(permissions, "Inventory");
        access.CanManagePricing = CanManageGroup(permissions, "Pricing");
        access.CanManageReservations = CanManageGroup(permissions, "Bookings");
        access.CanManagePayments = CanManageGroup(permissions, "Financial");
        access.CanManageReviews = CanManageGroup(permissions, "Reviews");
        access.CanManageNotifications = CanManageGroup(permissions, "Dashboard");
        access.CanViewReports = permissions.TryGetValue("Reports", out var reports) && reports.View;
    }

    private static bool CanManageGroup(PermissionMatrixDto permissions, string group) =>
        permissions.TryGetValue(group, out var actions) &&
        (actions.Create || actions.Edit || actions.Delete);

    private static IEnumerable<string> MatrixToPermissionKeys(PermissionMatrixDto matrix)
    {
        foreach (var (group, actions) in matrix)
        {
            var groupKey = group switch
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
            if (groupKey is null) continue;

            if (actions.View) yield return $"{groupKey}.view";
            if (actions.Create) yield return $"{groupKey}.create";
            if (actions.Edit) yield return $"{groupKey}.edit";
            if (actions.Delete)
            {
                yield return groupKey == "bookings" ? "bookings.cancel" : $"{groupKey}.delete";
            }
            if (actions.Export) yield return $"{groupKey}.export";
        }
    }

    private static PermissionMatrixDto DeserializeMatrix(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return BuildDefaultMatrix(PropertyUserRole.Manager);
        }

        try
        {
            var matrix = JsonSerializer.Deserialize<PermissionMatrixDto>(
                value,
                JsonOptions);
            return matrix is null || matrix.Count == 0
                ? BuildDefaultMatrix(PropertyUserRole.Manager)
                : NormalizeMatrix(matrix);
        }
        catch (JsonException)
        {
            return BuildDefaultMatrix(PropertyUserRole.Manager);
        }
    }

    private static PermissionMatrixDto NormalizeMatrix(PermissionMatrixDto matrix)
    {
        var normalized = new PermissionMatrixDto();
        foreach (var group in PermissionGroups)
        {
            var actions = matrix.TryGetValue(group, out var existing)
                ? existing
                : new PermissionActionsDto();
            normalized[group] = new PermissionActionsDto
            {
                View = actions.View,
                Create = actions.Create,
                Edit = actions.Edit,
                Delete = actions.Delete,
                Export = actions.Export
            };
        }
        return normalized;
    }

    private static PermissionMatrixDto BuildOwnerMatrix()
    {
        var matrix = new PermissionMatrixDto();
        foreach (var group in PermissionGroups)
        {
            matrix[group] = new PermissionActionsDto
            {
                View = true,
                Create = true,
                Edit = true,
                Delete = true,
                Export = true
            };
        }
        return matrix;
    }

    private static PermissionMatrixDto BuildDefaultMatrix(PropertyUserRole role)
    {
        var matrix = new PermissionMatrixDto();
        foreach (var group in PermissionGroups)
        {
            matrix[group] = new PermissionActionsDto();
        }

        void Allow(string group, bool create = false, bool edit = false, bool delete = false, bool export = false)
        {
            matrix[group] = new PermissionActionsDto
            {
                View = true,
                Create = create,
                Edit = edit,
                Delete = delete,
                Export = export
            };
        }

        switch (role)
        {
            case PropertyUserRole.Manager:
                Allow("Dashboard");
                Allow("Properties", create: true, edit: true);
                Allow("Rooms", create: true, edit: true, delete: true);
                Allow("Pricing", create: true, edit: true);
                Allow("Inventory", create: true, edit: true);
                Allow("Bookings", create: true, edit: true, delete: true, export: true);
                Allow("Reviews", edit: true, delete: true);
                Allow("Users", create: true, edit: true);
                Allow("Financial", export: true);
                Allow("Reports", export: true);
                Allow("Settings", edit: true);
                break;
            case PropertyUserRole.Reception:
                Allow("Dashboard");
                Allow("Rooms");
                Allow("Inventory");
                Allow("Bookings", create: true, edit: true, export: true);
                Allow("Reviews", edit: true);
                break;
            case PropertyUserRole.Accounting:
                Allow("Dashboard");
                Allow("Pricing");
                Allow("Financial", create: true, edit: true, export: true);
                Allow("Reports", export: true);
                break;
            case PropertyUserRole.Housekeeping:
                Allow("Dashboard");
                Allow("Rooms", edit: true);
                Allow("Inventory", edit: true);
                break;
            case PropertyUserRole.Custom:
            default:
                break;
        }

        return matrix;
    }

    private static readonly string[] PermissionGroups =
    [
        "Dashboard",
        "Properties",
        "Rooms",
        "Pricing",
        "Inventory",
        "Bookings",
        "Reviews",
        "Users",
        "Financial",
        "Reports",
        "Settings"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static (string FirstName, string LastName) SplitFullName(string fullName)
    {
        var parts = fullName.Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length switch
        {
            0 => ("User", "Property"),
            1 => (parts[0], ""),
            _ => (parts[0], parts[1])
        };
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
