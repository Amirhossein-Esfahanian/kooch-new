using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Text.Json;

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
        var query = dbContext.Users.IgnoreQueryFilters().AsNoTracking();
        if (currentRole is UserRole.Owner or UserRole.OwnerAssistant)
        {
            query = query.Where(user => user.ParentUserId == currentUserId);
        }

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
        if (currentRole is UserRole.Owner or UserRole.OwnerAssistant &&
            !await dbContext.Users.IgnoreQueryFilters().AnyAsync(user => user.Id == userId && user.ParentUserId == currentUserId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this user.");
        }

        return await Project(dbContext.Users.IgnoreQueryFilters().AsNoTracking().Where(user => user.Id == userId))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
    }

    public async Task<AdminUserResponse> CreateUserAsync(
        int currentUserId,
        UserRole currentRole,
        AdminUserRequest request,
        CancellationToken cancellationToken = default)
    {
        var propertyIds = GetRequestedPropertyIds(request);
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, propertyIds, cancellationToken);
        EnsurePropertyAssignmentIsValid(request.Role, propertyIds);

        var email = NormalizeEmail(request.Email);
        var mobile = NormalizeMobile(request.PhoneNumber);
        await EnsureUniqueIdentityAsync(email, mobile, null, cancellationToken);

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
            Role = request.Role,
            ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : currentUserId,
            IsActive = false,
            PasswordSetupRequired = true
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncPropertyAccessAsync(user, propertyIds, cancellationToken);
        var setupLink = await authService.CreatePasswordSetupTokenAsync(user.Id, cancellationToken);
        var response = await GetUserAsync(currentUserId, currentRole, user.Id, cancellationToken);
        if (appEnvironment.IsDevelopment())
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
        var propertyIds = GetRequestedPropertyIds(request);
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, propertyIds, cancellationToken);
        EnsurePropertyAssignmentIsValid(request.Role, propertyIds);
        var user = await dbContext.Users.IgnoreQueryFilters().SingleOrDefaultAsync(user => user.Id == userId, cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
        if (currentRole is UserRole.Owner or UserRole.OwnerAssistant && user.ParentUserId != currentUserId)
        {
            throw new UnauthorizedAccessException("You cannot edit this user.");
        }

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
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
            user.PasswordSetupRequired = false;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncPropertyAccessAsync(user, propertyIds, cancellationToken);
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
        if (currentRole is UserRole.Owner or UserRole.OwnerAssistant && user.ParentUserId != currentUserId)
        {
            throw new UnauthorizedAccessException("You cannot change this user.");
        }

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
                      await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageUsers, null, cancellationToken) ||
                      currentRole == UserRole.Owner ||
                      currentRole == UserRole.OwnerAssistant &&
                      await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageStaff, null, cancellationToken);

        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageUsers permission is required.");
        }
    }

    private async Task EnsureCanCreateRoleAsync(
        int currentUserId,
        UserRole currentRole,
        UserRole targetRole,
        IReadOnlyCollection<int> propertyIds,
        CancellationToken cancellationToken)
    {
        if (currentRole == UserRole.SuperAdmin)
        {
            return;
        }

        if (currentRole == UserRole.AdminAssistant)
        {
            var canManageUsers = await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageUsers, null, cancellationToken);
            var allowed = targetRole is UserRole.Owner or UserRole.OwnerAssistant or UserRole.Client ||
                          targetRole == UserRole.AdminAssistant && canManageUsers;
            if (allowed && (targetRole != UserRole.AdminAssistant || canManageUsers))
            {
                return;
            }
        }

        if (currentRole == UserRole.Owner)
        {
            if (targetRole is not UserRole.OwnerAssistant and not UserRole.Client)
            {
                throw new UnauthorizedAccessException("Owners can only create owner assistants or clients.");
            }

            if (propertyIds.Count > 0)
            {
                var ownedPropertyCount = await dbContext.Properties.AsNoTracking()
                    .CountAsync(property => propertyIds.Contains(property.Id) && property.OwnerId == currentUserId, cancellationToken);
                if (ownedPropertyCount != propertyIds.Count)
                {
                    throw new UnauthorizedAccessException("You can only grant access to your own properties.");
                }
            }
            return;
        }

        if (currentRole == UserRole.OwnerAssistant)
        {
            var canManageStaff = propertyIds.Count > 0
                ? await CanManageStaffForAllPropertiesAsync(currentUserId, propertyIds, cancellationToken)
                : await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageStaff, null, cancellationToken);
            if (canManageStaff && targetRole is UserRole.OwnerAssistant or UserRole.Client)
            {
                return;
            }
        }

        throw new UnauthorizedAccessException("You cannot create this user role.");
    }

    private async Task<bool> CanManageStaffForAllPropertiesAsync(
        int userId,
        IReadOnlyCollection<int> propertyIds,
        CancellationToken cancellationToken)
    {
        foreach (var propertyId in propertyIds)
        {
            if (!await permissionService.HasPermissionAsync(userId, PermissionKey.ManageStaff, propertyId, cancellationToken))
            {
                return false;
            }
        }

        return true;
    }

    private static void EnsurePropertyAssignmentIsValid(UserRole role, IReadOnlyCollection<int> propertyIds)
    {
        if (IsGlobalAdminRole(role))
        {
            return;
        }

        if (propertyIds.Count == 0)
        {
            throw new ArgumentException("برای این کاربر حداقل یک اقامتگاه انتخاب کنید.");
        }
    }

    private async Task SyncPropertyAccessAsync(
        User user,
        IReadOnlyCollection<int> propertyIds,
        CancellationToken cancellationToken)
    {
        if (IsGlobalAdminRole(user.Role))
        {
            var globalRoleAccesses = await dbContext.UserPropertyAccesses
                .Where(access => access.UserId == user.Id)
                .ToListAsync(cancellationToken);
            foreach (var access in globalRoleAccesses)
            {
                access.IsActive = false;
                access.Status = PropertyUserStatus.Inactive;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        var existingPropertiesCount = await dbContext.Properties.AsNoTracking()
            .CountAsync(property => propertyIds.Contains(property.Id), cancellationToken);
        if (existingPropertiesCount != propertyIds.Count)
        {
            throw new ArgumentException("اقامتگاه انتخاب‌شده معتبر نیست.");
        }

        var accesses = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == user.Id)
            .ToListAsync(cancellationToken);
        var requested = propertyIds.ToHashSet();
        var pending = user.PasswordSetupRequired || !user.IsActive;

        foreach (var access in accesses)
        {
            if (!requested.Contains(access.PropertyId))
            {
                access.IsActive = false;
                access.Status = PropertyUserStatus.Inactive;
                continue;
            }

            ApplyDefaultPropertyAccess(access, pending);
        }

        var existingPropertyIds = accesses.Select(access => access.PropertyId).ToHashSet();
        foreach (var propertyId in requested.Where(propertyId => !existingPropertyIds.Contains(propertyId)))
        {
            var access = new UserPropertyAccess
            {
                UserId = user.Id,
                PropertyId = propertyId
            };
            ApplyDefaultPropertyAccess(access, pending);
            dbContext.UserPropertyAccesses.Add(access);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static void ApplyDefaultPropertyAccess(UserPropertyAccess access, bool pending)
    {
        access.PropertyRole = PropertyUserRole.Manager;
        access.CanManageProperty = true;
        access.CanManageRooms = true;
        access.CanManageAvailability = true;
        access.CanManagePricing = true;
        access.CanManageReservations = true;
        access.CanManagePayments = true;
        access.CanManageReviews = true;
        access.CanManageNotifications = true;
        access.CanViewReports = true;
        access.PermissionMatrixJson = JsonSerializer.Serialize(BuildManagerMatrix(), JsonOptions);
        access.IsActive = !pending;
        access.Status = pending ? PropertyUserStatus.Pending : PropertyUserStatus.Active;
    }

    private static IReadOnlyList<int> GetRequestedPropertyIds(AdminUserRequest request)
    {
        var ids = new List<int>();
        if (request.PropertyId is > 0)
        {
            ids.Add(request.PropertyId.Value);
        }

        ids.AddRange(request.PropertyIds.Where(id => id > 0));
        return ids.Distinct().ToArray();
    }

    private static bool IsGlobalAdminRole(UserRole role) =>
        role is UserRole.SuperAdmin or UserRole.AdminAssistant;

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
            PropertyId = user.UserPropertyAccesses
                .Where(access => access.Status != PropertyUserStatus.Inactive)
                .OrderBy(access => access.PropertyId)
                .Select(access => (int?)access.PropertyId)
                .FirstOrDefault(),
            PropertyName = user.UserPropertyAccesses
                .Where(access => access.Status != PropertyUserStatus.Inactive)
                .OrderBy(access => access.PropertyId)
                .Select(access => access.Property.Name)
                .FirstOrDefault(),
            Properties = user.UserPropertyAccesses
                .Where(access => access.Status != PropertyUserStatus.Inactive)
                .OrderBy(access => access.Property.Name)
                .Select(access => new AdminUserPropertyAccessResponse
                {
                    PropertyId = access.PropertyId,
                    PropertyName = access.Property.Name,
                    Status = access.Status,
                    Role = access.PropertyRole,
                    IsActive = access.IsActive
                })
                .ToList(),
            IsActive = user.IsActive,
            PasswordSetupRequired = user.PasswordSetupRequired,
            CreatedAtUtc = user.CreatedAtUtc,
            InvitationAcceptedAtUtc = user.InvitationAcceptedAtUtc
        });

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
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

    private static PermissionMatrixDto BuildManagerMatrix()
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
}
