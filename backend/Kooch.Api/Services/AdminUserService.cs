using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class AdminUserService(
    KoochDbContext dbContext,
    IPermissionService permissionService) : IAdminUserService
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
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, request.PropertyId, cancellationToken);
        if (string.IsNullOrWhiteSpace(request.Password))
        {
            throw new ArgumentException("Password is required.");
        }

        var email = NormalizeEmail(request.Email);
        if (await dbContext.Users.IgnoreQueryFilters().AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw new InvalidOperationException("An account with this email already exists.");
        }

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            PhoneNumber = CleanOptional(request.PhoneNumber),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = request.Role,
            ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : currentUserId,
            IsActive = true
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        await UpsertPropertyAccessAsync(user.Id, request.PropertyId, request.Role, cancellationToken);
        return await GetUserAsync(currentUserId, currentRole, user.Id, cancellationToken);
    }

    public async Task<AdminUserResponse> UpdateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        AdminUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanCreateRoleAsync(currentUserId, currentRole, request.Role, request.PropertyId, cancellationToken);
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
        if (await dbContext.Users.IgnoreQueryFilters().AnyAsync(existing => existing.Email == email && existing.Id != userId, cancellationToken))
        {
            throw new InvalidOperationException("An account with this email already exists.");
        }

        user.FirstName = request.FirstName.Trim();
        user.LastName = request.LastName.Trim();
        user.Email = email;
        user.PhoneNumber = CleanOptional(request.PhoneNumber);
        user.Role = request.Role;
        user.ParentUserId = currentRole == UserRole.SuperAdmin ? request.ParentUserId : user.ParentUserId ?? currentUserId;
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await UpsertPropertyAccessAsync(user.Id, request.PropertyId, request.Role, cancellationToken);
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
        int? propertyId,
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

            if (propertyId.HasValue && !await dbContext.Properties.AsNoTracking()
                    .AnyAsync(property => property.Id == propertyId && property.OwnerId == currentUserId, cancellationToken))
            {
                throw new UnauthorizedAccessException("You can only grant access to your own properties.");
            }
            return;
        }

        if (currentRole == UserRole.OwnerAssistant)
        {
            var canManageStaff = propertyId.HasValue
                ? await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageStaff, propertyId, cancellationToken)
                : await permissionService.HasPermissionAsync(currentUserId, PermissionKey.ManageStaff, null, cancellationToken);
            if (canManageStaff && targetRole is UserRole.OwnerAssistant or UserRole.Client)
            {
                return;
            }
        }

        throw new UnauthorizedAccessException("You cannot create this user role.");
    }

    private async Task UpsertPropertyAccessAsync(
        int userId,
        int? propertyId,
        UserRole role,
        CancellationToken cancellationToken)
    {
        if (!propertyId.HasValue || role is not UserRole.OwnerAssistant)
        {
            return;
        }

        var access = await dbContext.UserPropertyAccesses
            .SingleOrDefaultAsync(access => access.UserId == userId && access.PropertyId == propertyId, cancellationToken);
        if (access is null)
        {
            dbContext.UserPropertyAccesses.Add(new UserPropertyAccess
            {
                UserId = userId,
                PropertyId = propertyId.Value,
                CanManageProperty = true,
                CanManageRooms = true,
                CanManageAvailability = true,
                CanManagePricing = true,
                IsActive = true
            });
        }
        else
        {
            access.IsActive = true;
            access.CanManageProperty = true;
            access.CanManageRooms = true;
            access.CanManageAvailability = true;
            access.CanManagePricing = true;
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
            IsActive = user.IsActive,
            CreatedAtUtc = user.CreatedAtUtc
        });

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
