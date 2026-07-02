using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyUserService(
    KoochDbContext dbContext,
    IPermissionService permissionService) : IPropertyUserService
{
    public async Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertyUsersAsync(currentUserId, currentRole, propertyId, cancellationToken);

        var property = await dbContext.Properties.AsNoTracking()
            .Include(item => item.Owner)
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var users = new List<PropertyUserResponse>
        {
            MapOwner(property)
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
                CanRemove = true
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
        await EnsureCanManagePropertyUsersAsync(currentUserId, currentRole, propertyId, cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be created from this page.");
        }

        var invitation = new PropertyUserRequest
        {
            FullName = request.FullName,
            Mobile = request.Mobile,
            Email = request.Email,
            Username = request.Username,
            Role = request.Role,
            Status = PropertyUserStatus.PendingInvitation,
            IsActive = false
        };

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
                IsActive = false
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
        return (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == user.Id);
    }

    public async Task<PropertyUserResponse> UpdateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        int userId,
        PropertyUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertyUsersAsync(currentUserId, currentRole, propertyId, cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be changed from this page.");
        }

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
        await EnsureCanManagePropertyUsersAsync(currentUserId, currentRole, propertyId, cancellationToken);
        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");
        if (property.OwnerId == userId)
        {
            throw new InvalidOperationException("Property owner cannot be removed.");
        }

        var access = await dbContext.UserPropertyAccesses
            .SingleOrDefaultAsync(item => item.UserId == userId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property user not found.");
        dbContext.UserPropertyAccesses.Remove(access);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureCanManagePropertyUsersAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var allowed = currentRole switch
        {
            UserRole.SuperAdmin => true,
            UserRole.Owner => await dbContext.Properties.AsNoTracking()
                .AnyAsync(property => property.Id == propertyId && property.OwnerId == currentUserId, cancellationToken),
            UserRole.AdminAssistant => await permissionService.HasPermissionAsync(
                currentUserId,
                PermissionKey.ManageUsers,
                propertyId,
                cancellationToken),
            UserRole.OwnerAssistant => await permissionService.HasPermissionAsync(
                    currentUserId,
                    PermissionKey.ManageStaff,
                    propertyId,
                    cancellationToken) ||
                await dbContext.UserPropertyAccesses.AsNoTracking()
                    .AnyAsync(access => access.UserId == currentUserId &&
                                        access.PropertyId == propertyId &&
                                        access.IsActive &&
                                        access.Status == PropertyUserStatus.Active &&
                                        access.PropertyRole == PropertyUserRole.Manager,
                        cancellationToken),
            _ => false
        };

        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot manage users for this property.");
        }
    }

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

    private static PropertyUserResponse MapOwner(Property property)
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
            CanRemove = false
        };
    }

    private static void ApplyRequest(UserPropertyAccess access, PropertyUserRequest request)
    {
        access.PropertyRole = request.Role;
        access.Status = request.Status;
        access.IsActive = request.IsActive && request.Status == PropertyUserStatus.Active;
        access.CanManageProperty = request.Role is PropertyUserRole.Manager or PropertyUserRole.Custom;
        access.CanManageRooms = request.Role is PropertyUserRole.Manager or PropertyUserRole.Reception or PropertyUserRole.Housekeeping or PropertyUserRole.Custom;
        access.CanManageAvailability = request.Role is PropertyUserRole.Manager or PropertyUserRole.Reception or PropertyUserRole.Housekeeping or PropertyUserRole.Custom;
        access.CanManagePricing = request.Role is PropertyUserRole.Manager or PropertyUserRole.Accounting or PropertyUserRole.Custom;
        access.CanManageReservations = request.Role is PropertyUserRole.Manager or PropertyUserRole.Reception or PropertyUserRole.Custom;
        access.CanManagePayments = request.Role is PropertyUserRole.Manager or PropertyUserRole.Accounting or PropertyUserRole.Custom;
        access.CanManageReviews = request.Role is PropertyUserRole.Manager or PropertyUserRole.Reception or PropertyUserRole.Custom;
        access.CanManageNotifications = request.Role is PropertyUserRole.Manager or PropertyUserRole.Reception or PropertyUserRole.Custom;
        access.CanViewReports = request.Role is PropertyUserRole.Manager or PropertyUserRole.Accounting or PropertyUserRole.Custom;
    }

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
