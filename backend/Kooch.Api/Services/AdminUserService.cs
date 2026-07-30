using System.Data;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Users;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace Kooch.Api.Services;

public class AdminUserService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IAuthService authService,
    IAuditLogService auditLogService,
    IHostEnvironment appEnvironment,
    ILogger<AdminUserService> logger) : IAdminUserService
{
    private const string LastSuperAdminError = "حداقل یک مدیر ارشد فعال باید در سامانه باقی بماند.";
    private const string PropertyOwnerDeactivationError = "پیش از غیرفعال‌کردن این کاربر، مالکیت اقامتگاه‌های او را منتقل کنید.";

    public async Task<IReadOnlyList<AdminUserResponse>> GetUsersAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageUsersAsync(currentUserId, currentRole, cancellationToken);
        var query = dbContext.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => !user.IsDeleted &&
                           (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant));

        return await Project(query.OrderBy(user => user.LastName).ThenBy(user => user.FirstName))
            .ToListAsync(cancellationToken);
    }

    public async Task<AdminUserResponse> GetUserAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageUsersAsync(currentUserId, currentRole, cancellationToken);
        return await Project(dbContext.Users.IgnoreQueryFilters().AsNoTracking().Where(user =>
                user.Id == userId &&
                !user.IsDeleted &&
                (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant)))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
    }

    public async Task<AdminUserResponse> CreateUserAsync(
        int currentUserId,
        UserRole currentRole,
        AdminUserRequest request,
        CancellationToken cancellationToken = default)
    {
        var permissions = ParsePermissions(request.Permissions);
        ValidatePlatformAccountRole(request.Role);
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, cancellationToken);
        await EnsureCanAssignPermissionsAsync(
            currentUserId,
            currentRole,
            request.Role,
            permissions,
            cancellationToken);

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        var identity = CreateUserIdentity(request.FirstName, request.LastName, request.PhoneNumber, request.Email);
        var email = identity.Email;
        var mobile = identity.PhoneNumber;
        await EnsureUniqueIdentityAsync(email, mobile, null, cancellationToken);
        var hasPassword = !string.IsNullOrWhiteSpace(request.Password);
        if (hasPassword)
        {
            PasswordPolicy.Validate(request.Password!);
        }

        var user = new User
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
            Email = email,
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(hasPassword ? request.Password! : Guid.NewGuid().ToString("N")),
            Role = request.Role,
            ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : currentUserId,
            IsActive = hasPassword,
            PasswordSetupRequired = !hasPassword
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncGlobalPermissionsAsync(user, permissions, cancellationToken);
        string? setupLink = null;
        if (!hasPassword)
        {
            setupLink = await authService.CreatePasswordSetupTokenWithoutNotificationAsync(user.Id, cancellationToken);
        }

        auditLogService.Add(
            currentUserId,
            AuditAction.PlatformAdminCreated,
            nameof(User),
            user.Id,
            entityName: user.Role.ToString(),
            description: $"Platform admin created with role {user.Role}.");
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (setupLink is not null)
        {
            await TrySendPasswordSetupNotificationAsync(user.Id, setupLink, cancellationToken);
        }

        var response = await GetUserAsync(currentUserId, currentRole, user.Id, cancellationToken);
        if (setupLink is not null && appEnvironment.IsDevelopment())
        {
            response.TemporarySetupLink = setupLink;
        }
        return response;
    }

    public async Task<AdminUserResponse> UpdateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        AdminUserRequest request,
        CancellationToken cancellationToken = default)
    {
        var permissions = ParsePermissions(request.Permissions);
        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        var user = await dbContext.Users.IgnoreQueryFilters().SingleOrDefaultAsync(
                user => user.Id == userId && !user.IsDeleted,
                cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
        ValidatePlatformAccountRole(user.Role);
        ValidatePlatformAccountRole(request.Role);
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, cancellationToken);
        await EnsureCanAssignPermissionsAsync(
            currentUserId,
            currentRole,
            request.Role,
            permissions,
            cancellationToken);
        if (user.Role == UserRole.SuperAdmin && currentRole != UserRole.SuperAdmin)
        {
            throw new UnauthorizedAccessException("Only SuperAdmin can edit SuperAdmin users.");
        }

        var identity = CreateUserIdentity(request.FirstName, request.LastName, request.PhoneNumber, request.Email);
        var email = identity.Email;
        var mobile = identity.PhoneNumber;
        await EnsureUniqueIdentityAsync(email, mobile, userId, cancellationToken);

        var roleChanged = user.Role != request.Role;
        var passwordChanged = !string.IsNullOrWhiteSpace(request.Password);
        await EnsureSuperAdminAuthorityRemainsAsync(user, request.Role, user.IsActive, cancellationToken);
        var existingPermissions = await dbContext.UserPermissions.AsNoTracking()
            .Where(permission => permission.UserId == user.Id && permission.IsAllowed)
            .Select(permission => permission.PermissionKey)
            .ToListAsync(cancellationToken);
        var permissionChanged = !existingPermissions.ToHashSet().SetEquals(
            request.Role == UserRole.AdminAssistant ? permissions : []);

        user.FirstName = identity.FirstName;
        user.LastName = identity.LastName;
        user.Email = email;
        user.PhoneNumber = mobile;
        user.Role = request.Role;
        if (roleChanged)
        {
            user.CanBeRestricted = request.Role != UserRole.SuperAdmin;
        }
        user.ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : user.ParentUserId ?? currentUserId;
        if (passwordChanged)
        {
            PasswordPolicy.Validate(request.Password!);
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password!);
            user.PasswordSetupRequired = false;
            user.IsActive = true;
        }

        if (roleChanged || passwordChanged)
        {
            user.SecurityStampVersion++;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncGlobalPermissionsAsync(user, permissions, cancellationToken);
        if (passwordChanged)
        {
            await RevokePasswordSetupTokensAsync(user.Id, cancellationToken);
        }

        auditLogService.Add(
            currentUserId,
            AuditAction.PlatformAdminUpdated,
            nameof(User),
            user.Id,
            entityName: user.Role.ToString(),
            description: BuildUpdateAuditDescription(roleChanged, permissionChanged, passwordChanged));
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return await GetUserAsync(currentUserId, currentRole, userId, cancellationToken);
    }

    public async Task<AdminUserResponse> SetActiveAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        bool isActive,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageUsersAsync(currentUserId, currentRole, cancellationToken);
        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        var user = await dbContext.Users.IgnoreQueryFilters().SingleOrDefaultAsync(
                user => user.Id == userId && !user.IsDeleted,
                cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
        ValidatePlatformAccountRole(user.Role);

        if (user.Role == UserRole.SuperAdmin && currentRole != UserRole.SuperAdmin)
        {
            throw new UnauthorizedAccessException("Only SuperAdmin can activate or deactivate SuperAdmin users.");
        }

        if (user.Id == currentUserId ||
            (user.Role != UserRole.SuperAdmin && !user.CanBeRestricted))
        {
            throw new InvalidOperationException("This user cannot be activated or deactivated here.");
        }

        await EnsureSuperAdminAuthorityRemainsAsync(user, user.Role, isActive, cancellationToken);
        if (!isActive && await dbContext.Properties.IgnoreQueryFilters()
                .AnyAsync(property => !property.IsDeleted && property.OwnerId == user.Id, cancellationToken))
        {
            throw new InvalidOperationException(PropertyOwnerDeactivationError);
        }

        var wasActive = user.IsActive;
        user.IsActive = isActive;
        if (wasActive && !isActive)
        {
            user.SecurityStampVersion++;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        auditLogService.Add(
            currentUserId,
            isActive ? AuditAction.PlatformAdminActivated : AuditAction.PlatformAdminDeactivated,
            nameof(User),
            user.Id,
            entityName: user.Role.ToString(),
            description: isActive ? "Platform admin activated." : "Platform admin deactivated.");
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return await GetUserAsync(currentUserId, currentRole, userId, cancellationToken);
    }

    private async Task EnsureSuperAdminAuthorityRemainsAsync(
        User user,
        UserRole resultingRole,
        bool resultingIsActive,
        CancellationToken cancellationToken)
    {
        var removesActiveAuthority = user.Role == UserRole.SuperAdmin &&
                                     user.IsActive &&
                                     !user.IsDeleted &&
                                     (resultingRole != UserRole.SuperAdmin || !resultingIsActive);
        if (!removesActiveAuthority)
        {
            return;
        }

        var anotherActiveSuperAdminExists = await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(candidate =>
                    candidate.Id != user.Id &&
                    candidate.Role == UserRole.SuperAdmin &&
                    candidate.IsActive &&
                    !candidate.IsDeleted,
                cancellationToken);
        if (!anotherActiveSuperAdminExists)
        {
            throw new InvalidOperationException(LastSuperAdminError);
        }
    }

    private async Task RevokePasswordSetupTokensAsync(int userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var activeTokens = await dbContext.PasswordSetupTokens
            .Where(token => token.UserId == userId && token.UsedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var token in activeTokens)
        {
            token.UsedAtUtc = now;
        }
    }

    private async Task TrySendPasswordSetupNotificationAsync(
        int userId,
        string setupLink,
        CancellationToken cancellationToken)
    {
        try
        {
            await authService.SendPasswordSetupNotificationAsync(userId, setupLink, cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Password setup notification failed after platform admin {UserId} was committed.",
                userId);
        }
    }

    private static string BuildUpdateAuditDescription(
        bool roleChanged,
        bool permissionChanged,
        bool passwordChanged)
    {
        var changes = new List<string>();
        if (roleChanged) changes.Add("role");
        if (permissionChanged) changes.Add("permissions");
        if (passwordChanged) changes.Add("password");
        return changes.Count == 0
            ? "Platform admin profile updated."
            : $"Platform admin updated: {string.Join(", ", changes)}.";
    }

    private async Task EnsureCanManageUsersAsync(int currentUserId, UserRole currentRole, CancellationToken cancellationToken)
    {
        var allowed = currentRole == UserRole.SuperAdmin ||
                      currentRole == UserRole.AdminAssistant &&
                      await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageUsers, null, cancellationToken);

        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageUsers permission is required.");
        }
    }

    private async Task EnsureCanCreateRoleAsync(
        int currentUserId,
        UserRole currentRole,
        UserRole targetRole,
        CancellationToken cancellationToken)
    {
        if (currentRole == UserRole.SuperAdmin)
        {
            return;
        }

        if (currentRole == UserRole.AdminAssistant)
        {
            var canManageUsers = await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageUsers, null, cancellationToken);
            if (targetRole == UserRole.AdminAssistant && canManageUsers)
            {
                return;
            }
        }

        throw new UnauthorizedAccessException("You cannot create or assign this platform role.");
    }

    private static void ValidatePlatformAccountRole(UserRole role)
    {
        if (role is not UserRole.SuperAdmin and not UserRole.AdminAssistant)
        {
            throw new ArgumentException("Platform Admin Users supports only SuperAdmin and AdminAssistant accounts.");
        }
    }

    private static IReadOnlySet<PermissionKey> ParsePermissions(IReadOnlyList<string>? permissionNames)
    {
        var permissions = new HashSet<PermissionKey>();
        foreach (var permissionName in permissionNames ?? [])
        {
            if (string.IsNullOrWhiteSpace(permissionName) ||
                !Enum.TryParse<PermissionKey>(permissionName, ignoreCase: false, out var permission) ||
                !Enum.IsDefined(permission))
            {
                throw new ArgumentException($"Unknown permission: {permissionName}");
            }

            permissions.Add(permission);
        }

        return permissions;
    }

    private async Task EnsureCanAssignPermissionsAsync(
        int currentUserId,
        UserRole currentRole,
        UserRole targetRole,
        IReadOnlySet<PermissionKey> permissions,
        CancellationToken cancellationToken)
    {
        if (targetRole != UserRole.AdminAssistant && permissions.Count > 0)
        {
            throw new ArgumentException("Global permissions can only be assigned to admin assistants.");
        }

        if (permissions.Count == 0 || currentRole == UserRole.SuperAdmin)
        {
            return;
        }

        var assignablePermissions = await dbContext.UserPermissions.AsNoTracking()
            .Where(permission =>
                permission.UserId == currentUserId &&
                permission.IsAllowed)
            .Select(permission => permission.PermissionKey)
            .ToListAsync(cancellationToken);
        if (!permissions.IsSubsetOf(assignablePermissions))
        {
            throw new UnauthorizedAccessException("You cannot assign permissions that you do not have.");
        }
    }

    private async Task SyncGlobalPermissionsAsync(
        User user,
        IReadOnlySet<PermissionKey> requestedPermissions,
        CancellationToken cancellationToken)
    {
        var existingPermissions = await dbContext.UserPermissions
            .Where(permission => permission.UserId == user.Id)
            .ToListAsync(cancellationToken);
        var requested = user.Role == UserRole.AdminAssistant
            ? requestedPermissions
            : new HashSet<PermissionKey>();

        foreach (var permission in existingPermissions)
        {
            permission.IsAllowed = requested.Contains(permission.PermissionKey);
        }

        var existingKeys = existingPermissions.Select(permission => permission.PermissionKey).ToHashSet();
        foreach (var permissionKey in requested.Where(permissionKey => !existingKeys.Contains(permissionKey)))
        {
            dbContext.UserPermissions.Add(new UserPermission
            {
                UserId = user.Id,
                PermissionKey = permissionKey,
                IsAllowed = true
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static IQueryable<AdminUserResponse> Project(IQueryable<User> query) =>
        query.Select(user => new AdminUserResponse
        {
            Id = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            FullName = (user.FirstName + " " + user.LastName).Trim(),
            Email = user.Email ?? string.Empty,
            PhoneNumber = user.PhoneNumber,
            Role = user.Role.ToCanonicalPlatformRole(),
            ParentUserId = user.ParentUserId,
            ParentUserName = user.ParentUser == null ? null : (user.ParentUser.FirstName + " " + user.ParentUser.LastName).Trim(),
            Permissions = user.UserPermissions
                .Where(permission => permission.IsAllowed)
                .OrderBy(permission => permission.PermissionKey)
                .Select(permission => permission.PermissionKey)
                .ToList(),
            IsActive = user.IsActive,
            PasswordSetupRequired = user.PasswordSetupRequired,
            CreatedAtUtc = user.CreatedAtUtc,
            InvitationAcceptedAtUtc = user.InvitationAcceptedAtUtc
        });

    private static UserIdentityInput CreateUserIdentity(
        string firstName,
        string lastName,
        string phoneNumber,
        string? email)
    {
        var normalizedPhone = UserIdentityNormalization.NormalizePhoneNumber(phoneNumber)
            ?? throw new ArgumentException("Mobile number is required.");
        return new UserIdentityInput(
            UserIdentityNormalization.NormalizeName(firstName),
            UserIdentityNormalization.NormalizeName(lastName),
            normalizedPhone,
            UserIdentityNormalization.NormalizeEmail(email));
    }

    private async Task EnsureUniqueIdentityAsync(
        string? email,
        string mobile,
        int? currentUserId,
        CancellationToken cancellationToken)
    {
        if (email is not null && await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email &&
                                  (!currentUserId.HasValue || user.Id != currentUserId.Value),
                    cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicateEmailMessage);
        }

        var mobileVariants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.PhoneNumber != null &&
                                  mobileVariants.Contains(user.PhoneNumber) &&
                                  (!currentUserId.HasValue || user.Id != currentUserId.Value),
                    cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicatePhoneNumberMessage);
        }

        if (await dbContext.Guests.AsNoTracking()
            .AnyAsync(guest =>
                    (email != null && guest.NormalizedEmail == email) ||
                    guest.NormalizedMobile == mobile,
                cancellationToken))
        {
            throw new ArgumentException("Guest with this mobile or email already exists.");
        }
    }
}
