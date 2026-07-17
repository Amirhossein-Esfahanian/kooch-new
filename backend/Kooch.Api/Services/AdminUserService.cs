using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace Kooch.Api.Services;

public class AdminUserService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IAuthService authService,
    IHostEnvironment appEnvironment) : IAdminUserService
{
    public async Task<IReadOnlyList<AdminUserResponse>> GetUsersAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManageUsersAsync(currentUserId, currentRole, cancellationToken);
        var query = dbContext.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant);

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

        var email = NormalizeEmail(request.Email);
        var mobile = NormalizeMobile(request.PhoneNumber);
        await EnsureUniqueIdentityAsync(email, mobile, null, cancellationToken);
        var hasPassword = !string.IsNullOrWhiteSpace(request.Password);
        if (hasPassword)
        {
            PasswordPolicy.Validate(request.Password!);
        }

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
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
        var response = await GetUserAsync(currentUserId, currentRole, user.Id, cancellationToken);
        if (!hasPassword)
        {
            var setupLink = await authService.CreatePasswordSetupTokenAsync(user.Id, cancellationToken);
            if (appEnvironment.IsDevelopment())
            {
                response.TemporarySetupLink = setupLink;
            }
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
        var user = await dbContext.Users.IgnoreQueryFilters().SingleOrDefaultAsync(user => user.Id == userId, cancellationToken)
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

        var email = NormalizeEmail(request.Email);
        var mobile = NormalizeMobile(request.PhoneNumber);
        await EnsureUniqueIdentityAsync(email, mobile, userId, cancellationToken);

        user.FirstName = request.FirstName.Trim();
        user.LastName = request.LastName.Trim();
        user.Email = email;
        user.PhoneNumber = mobile;
        user.Role = request.Role;
        user.ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : user.ParentUserId ?? currentUserId;
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            PasswordPolicy.Validate(request.Password);
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
            user.PasswordSetupRequired = false;
            user.IsActive = true;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncGlobalPermissionsAsync(user, permissions, cancellationToken);
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
        var user = await dbContext.Users.IgnoreQueryFilters().SingleOrDefaultAsync(user => user.Id == userId, cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
        ValidatePlatformAccountRole(user.Role);

        if (!user.CanBeRestricted || user.Id == currentUserId)
        {
            throw new InvalidOperationException("This user cannot be activated or deactivated here.");
        }

        user.IsActive = isActive;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetUserAsync(currentUserId, currentRole, userId, cancellationToken);
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
                permission.PropertyId == null &&
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
            .Where(permission => permission.UserId == user.Id && permission.PropertyId == null)
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
            Email = user.Email,
            PhoneNumber = user.PhoneNumber,
            Role = user.Role,
            ParentUserId = user.ParentUserId,
            ParentUserName = user.ParentUser == null ? null : (user.ParentUser.FirstName + " " + user.ParentUser.LastName).Trim(),
            Permissions = user.UserPermissions
                .Where(permission => permission.PropertyId == null && permission.IsAllowed)
                .OrderBy(permission => permission.PermissionKey)
                .Select(permission => permission.PermissionKey)
                .ToList(),
            IsActive = user.IsActive,
            PasswordSetupRequired = user.PasswordSetupRequired,
            CreatedAtUtc = user.CreatedAtUtc,
            InvitationAcceptedAtUtc = user.InvitationAcceptedAtUtc
        });

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private async Task EnsureUniqueIdentityAsync(
        string email,
        string? mobile,
        int? currentUserId,
        CancellationToken cancellationToken)
    {
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email &&
                                  (!currentUserId.HasValue || user.Id != currentUserId.Value),
                    cancellationToken))
        {
            throw new ArgumentException("این ایمیل قبلاً ثبت شده است.");
        }

        if (string.IsNullOrWhiteSpace(mobile))
        {
            if (await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.NormalizedEmail == email, cancellationToken))
            {
                throw new ArgumentException("Guest with this email already exists.");
            }

            return;
        }

        var mobileVariants = BuildMobileVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.PhoneNumber != null &&
                                  mobileVariants.Contains(user.PhoneNumber) &&
                                  (!currentUserId.HasValue || user.Id != currentUserId.Value),
                    cancellationToken))
        {
            throw new ArgumentException("این شماره موبایل قبلاً ثبت شده است.");
        }
        if (await dbContext.Guests.AsNoTracking()
            .AnyAsync(guest =>
                    guest.NormalizedEmail == email ||
                    guest.NormalizedMobile == mobile,
                cancellationToken))
        {
            throw new ArgumentException("Guest with this mobile or email already exists.");
        }
    }

    private static string? NormalizeMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;

        var builder = new System.Text.StringBuilder();
        foreach (var character in mobile.Trim())
        {
            var normalized = character switch
            {
                >= '۰' and <= '۹' => (char)('0' + character - '۰'),
                >= '٠' and <= '٩' => (char)('0' + character - '٠'),
                _ => character
            };
            if (char.IsDigit(normalized) || normalized == '+')
            {
                builder.Append(normalized);
            }
        }

        var value = builder.ToString();
        if (value.StartsWith("0098", StringComparison.Ordinal))
        {
            value = $"0{value[4..]}";
        }
        else if (value.StartsWith("+98", StringComparison.Ordinal))
        {
            value = $"0{value[3..]}";
        }
        else if (value.StartsWith("98", StringComparison.Ordinal) && value.Length == 12)
        {
            value = $"0{value[2..]}";
        }

        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string[] BuildMobileVariants(string mobile)
    {
        var variants = new HashSet<string> { mobile };
        if (mobile.StartsWith('0') && mobile.Length > 1)
        {
            variants.Add($"+98{mobile[1..]}");
            variants.Add($"98{mobile[1..]}");
            variants.Add($"0098{mobile[1..]}");
        }

        return variants.ToArray();
    }

}
