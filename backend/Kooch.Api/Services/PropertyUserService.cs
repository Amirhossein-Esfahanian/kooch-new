using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Users;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using System.Text.Json;

namespace Kooch.Api.Services;

public class PropertyUserService(
    KoochDbContext dbContext,
    IPropertyAuthorizationService propertyAuthorizationService,
    IAuthService authService,
    IHostEnvironment appEnvironment) : IPropertyUserService
{
    public async Task<PropertyPermissionMetadataResponse> GetPermissionMetadataAsync(
        int currentUserId,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.view", cancellationToken);

        var effectivePermissions = await propertyAuthorizationService.GetEffectivePropertyPermissionsAsync(
            currentUserId,
            propertyId,
            cancellationToken)
            ?? throw new UnauthorizedAccessException("You cannot access this property.");
        var supportedActions = PropertyPermissionMatrixDefaults.ActionDefinitions
            .Select(action => action.Key)
            .ToArray();

        return new PropertyPermissionMetadataResponse
        {
            Groups = PropertyPermissionMatrixDefaults.GroupDefinitions
                .Select(group => new PropertyPermissionGroupMetadataResponse
                {
                    Key = group.Key,
                    Label = group.Label,
                    SupportedActions = supportedActions
                })
                .ToArray(),
            Actions = PropertyPermissionMatrixDefaults.ActionDefinitions
                .Select(action => new PropertyPermissionActionMetadataResponse
                {
                    Key = action.Key,
                    Label = action.Label
                })
                .ToArray(),
            RoleDefaults = Enum.GetValues<PropertyUserRole>()
                .ToDictionary(role => role, PropertyPermissionMatrixDefaults.CreateForRole),
            ActorAssignablePermissions = NormalizeMatrix(effectivePermissions.PermissionMatrix)
        };
    }

    public async Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.view", cancellationToken);

        var property = await dbContext.Properties.AsNoTracking()
            .Include(item => item.Owner)
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var ownerLastActivity = await GetLastActivityAsync(propertyId, property.OwnerId, cancellationToken);
        var ownerAccess = await dbContext.UserPropertyAccesses.AsNoTracking()
            .SingleOrDefaultAsync(access =>
                access.PropertyId == propertyId &&
                access.UserId == property.OwnerId &&
                access.PropertyRole == PropertyUserRole.PropertyOwner,
                cancellationToken);
        var users = new List<PropertyUserResponse>
        {
            MapOwner(property, ownerAccess, ownerLastActivity)
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
                Email = access.User.Email ?? string.Empty,
                Username = string.IsNullOrWhiteSpace(access.User.Username) ? access.User.Email ?? access.User.PhoneNumber ?? string.Empty : access.User.Username!,
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

    public async Task<PropertyUserCandidateResponse> ResolveCandidateAsync(
        int currentUserId,
        int propertyId,
        PropertyUserCandidateRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(
            currentUserId,
            propertyId,
            "users.create",
            cancellationToken);

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile);
        if (mobile is null)
        {
            return UnavailableCandidate();
        }

        var users = await FindUsersByMobileAsync(mobile, cancellationToken);
        if (users.Count > 1)
        {
            return UnavailableCandidate();
        }

        var user = users.SingleOrDefault();
        if (user is null)
        {
            var conflictsWithGuest = await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.NormalizedMobile == mobile, cancellationToken);
            return conflictsWithGuest
                ? UnavailableCandidate()
                : new PropertyUserCandidateResponse
                {
                    Outcome = PropertyUserCandidateOutcome.CanContinue,
                    RequiresUserCreation = true
                };
        }

        if (user.IsDeleted)
        {
            return UnavailableCandidate();
        }

        var alreadyMember = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .AnyAsync(
                access => access.UserId == user.Id && access.PropertyId == propertyId,
                cancellationToken);
        if (alreadyMember)
        {
            return new PropertyUserCandidateResponse
            {
                Outcome = PropertyUserCandidateOutcome.AlreadyMember
            };
        }

        return new PropertyUserCandidateResponse
        {
            Outcome = PropertyUserCandidateOutcome.CanContinue,
            RequiresUserCreation = false,
            MaskedName = MaskName(user)
        };
    }

    public async Task<PropertyUserResponse> CreateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        PropertyUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.create", cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be created from this page.");
        }
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            propertyId,
            request.Role,
            "create",
            cancellationToken);

        var permissions = request.Permissions
            ?? PropertyPermissionMatrixDefaults.CreateForRole(request.Role);
        await EnsureCanGrantPermissionsAsync(
            currentUserId,
            propertyId,
            permissions,
            null,
            cancellationToken);

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile)
            ?? throw new ArgumentException("شماره موبایل را وارد کنید.");

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var matchingUsers = await FindUsersByMobileAsync(mobile, cancellationToken);
        if (matchingUsers.Count > 1)
        {
            throw CandidateUnavailableException();
        }

        var user = matchingUsers.SingleOrDefault();
        var isNewUser = user is null;
        if (user is { IsDeleted: true })
        {
            throw CandidateUnavailableException();
        }

        if (user is null)
        {
            var conflictsWithGuestMobile = await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.NormalizedMobile == mobile, cancellationToken);
            if (conflictsWithGuestMobile || string.IsNullOrWhiteSpace(request.FullName))
            {
                throw CandidateUnavailableException();
            }

            var identity = CreateUserIdentityFromFullName(
                request.FullName!,
                mobile,
                request.Email);
            var email = identity.Email;
            var hasIdentityConflict =
                email is not null &&
                (await dbContext.Users.IgnoreQueryFilters()
                     .AnyAsync(item => item.Email == email, cancellationToken) ||
                 await dbContext.Guests.AsNoTracking()
                     .AnyAsync(guest => guest.NormalizedEmail == email, cancellationToken));
            if (hasIdentityConflict)
            {
                throw CandidateUnavailableException();
            }

            user = new User
            {
                FirstName = identity.FirstName,
                LastName = identity.LastName,
                Email = email,
                Username = email ?? mobile,
                PhoneNumber = mobile,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
                Role = UserRole.Client,
                ParentUserId = currentUserId,
                IsActive = false,
                PasswordSetupRequired = true
            };
            dbContext.Users.Add(user);
        }

        var duplicateMembership = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .AnyAsync(
                access => access.UserId == user.Id && access.PropertyId == propertyId,
                cancellationToken);
        if (duplicateMembership)
        {
            throw new InvalidOperationException("این کاربر قبلاً عضو این اقامتگاه است.");
        }

        var access = new UserPropertyAccess
        {
            User = user,
            PropertyId = propertyId,
            PropertyRole = request.Role,
            Status = request.Status
        };
        dbContext.UserPropertyAccesses.Add(access);
        ApplyRequest(access, request);

        if (NeedsPasswordSetup(user))
        {
            user.PasswordSetupRequired = true;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        var setupLink = string.Empty;
        if (NeedsPasswordSetup(user))
        {
            setupLink = await authService.CreatePasswordSetupTokenAsync(
                user.Id,
                cancellationToken);
        }

        var response = (await GetUsersAsync(
                currentUserId,
                currentRole,
                propertyId,
                cancellationToken))
            .Single(item => item.UserId == user.Id);
        if (!string.IsNullOrWhiteSpace(setupLink) && appEnvironment.IsDevelopment())
        {
            response.TemporarySetupLink = setupLink;
        }

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
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
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.edit", cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be changed from this page.");
        }
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
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
            propertyId,
            access.PropertyRole,
            "edit",
            cancellationToken);

        var identity = CreateUserIdentityFromFullName(
            request.FullName ?? throw new ArgumentException("Full name is required."),
            request.Mobile,
            request.Email);
        var email = identity.Email;
        var mobile = identity.PhoneNumber;
        await EnsureUniqueIdentityAsync(email, mobile, userId, cancellationToken);

        access.User.FirstName = identity.FirstName;
        access.User.LastName = identity.LastName;
        access.User.Email = email;
        access.User.Username = CleanOptional(request.Username) ?? email ?? mobile;
        access.User.PhoneNumber = mobile;
        await EnsureCanGrantPermissionsAsync(
            currentUserId,
            propertyId,
            request.Permissions ?? PropertyPermissionMatrixDefaults.CreateForRole(request.Role),
            DeserializeMatrix(access.PermissionMatrixJson),
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
            .SingleOrDefaultAsync(item => item.UserId == userId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property user not found.");
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            propertyId,
            access.PropertyRole,
            "change status for",
            cancellationToken);
        access.Status = status;
        access.IsActive = status == PropertyUserStatus.Active;
        await dbContext.SaveChangesAsync(cancellationToken);
        return (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == userId);
    }

    public async Task<PropertyUserResponse> ResendInvitationAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.edit", cancellationToken);

        var access = await dbContext.UserPropertyAccesses
            .Include(item => item.User)
            .SingleOrDefaultAsync(item => item.UserId == userId && item.PropertyId == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property user not found.");
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            propertyId,
            access.PropertyRole,
            "resend invitation for",
            cancellationToken);

        if (!NeedsPasswordSetup(access.User))
        {
            throw new InvalidOperationException("This user already has a password and does not need a setup invitation.");
        }

        access.User.PasswordSetupRequired = true;
        await dbContext.SaveChangesAsync(cancellationToken);
        var setupLink = await authService.CreatePasswordSetupTokenAsync(access.UserId, cancellationToken);
        var response = (await GetUsersAsync(currentUserId, currentRole, propertyId, cancellationToken))
            .Single(item => item.UserId == userId);
        if (appEnvironment.IsDevelopment())
        {
            response.TemporarySetupLink = setupLink;
        }
        return response;
    }
    private async Task EnsureCanUseUsersPermissionAsync(
        int currentUserId,
        int propertyId,
        string permissionKey,
        CancellationToken cancellationToken)
    {
        var allowed = await propertyAuthorizationService.HasPropertyPermissionAsync(
            currentUserId,
            propertyId,
            permissionKey,
            cancellationToken);

        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot manage users for this property.");
        }
    }

    private async Task EnsureCanGrantPermissionsAsync(
        int currentUserId,
        int propertyId,
        PermissionMatrixDto requestedPermissions,
        PermissionMatrixDto? existingPermissions,
        CancellationToken cancellationToken)
    {
        ValidatePropertyScopedPermissions(requestedPermissions);

        var effectivePermissions = await propertyAuthorizationService.GetEffectivePropertyPermissionsAsync(
            currentUserId,
            propertyId,
            cancellationToken);
        if (effectivePermissions?.IsSuperAdminBypass == true)
        {
            return;
        }

        var requestedValues = MatrixToPermissionValues(NormalizeMatrix(requestedPermissions));
        var existingValues = MatrixToPermissionValues(
                NormalizeMatrix(existingPermissions ?? []))
            .ToDictionary(item => item.PermissionKey, item => item.IsAllowed);

        foreach (var (permissionKey, isAllowed) in requestedValues)
        {
            if (existingValues[permissionKey] == isAllowed) continue;

            if (!await propertyAuthorizationService.HasPropertyPermissionAsync(
                    currentUserId,
                    propertyId,
                    permissionKey,
                    cancellationToken))
            {
                throw new UnauthorizedAccessException(
                    $"You cannot change permission '{permissionKey}' because you do not have it for this property.");
            }
        }
    }

    private static void ValidatePropertyScopedPermissions(PermissionMatrixDto permissions)
    {
        foreach (var (group, actions) in permissions)
        {
            if (!PermissionGroups.Contains(group, StringComparer.Ordinal) || actions is null)
            {
                throw new ArgumentException(
                    $"Permission group '{group}' is not a property-scoped permission.");
            }
        }
    }

    private async Task EnsureCanManageTargetRoleAsync(
        int currentUserId,
        int propertyId,
        PropertyUserRole targetRole,
        string action,
        CancellationToken cancellationToken)
    {
        var actorRole = await GetActorPropertyRoleAsync(currentUserId, propertyId, cancellationToken);
        if (RoleRank(targetRole) > RoleRank(actorRole))
        {
            throw new UnauthorizedAccessException(
                $"You cannot {action} a user with a higher property role.");
        }
    }

    private async Task<PropertyUserRole> GetActorPropertyRoleAsync(
        int currentUserId,
        int propertyId,
        CancellationToken cancellationToken)
    {
        var effectivePermissions = await propertyAuthorizationService.GetEffectivePropertyPermissionsAsync(
            currentUserId,
            propertyId,
            cancellationToken);
        if (effectivePermissions?.IsSuperAdminBypass == true)
        {
            return PropertyUserRole.PropertyOwner;
        }

        return effectivePermissions?.PropertyRole ?? PropertyUserRole.Custom;
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

    private static PropertyUserResponse MapOwner(
        Property property,
        UserPropertyAccess? access,
        DateTime? lastActivityAtUtc)
    {
        var owner = property.Owner;
        return new PropertyUserResponse
        {
            Id = access?.Id ?? 0,
            UserId = property.OwnerId,
            PropertyId = property.Id,
            FullName = (owner.FirstName + " " + owner.LastName).Trim(),
            Mobile = owner.PhoneNumber,
            Email = owner.Email ?? string.Empty,
            Username = string.IsNullOrWhiteSpace(owner.Username) ? owner.Email ?? owner.PhoneNumber ?? string.Empty : owner.Username!,
            Status = access?.Status ?? PropertyUserStatus.Inactive,
            Role = PropertyUserRole.PropertyOwner,
            IsActive = owner.IsActive && access is { IsActive: true, Status: PropertyUserStatus.Active },
            PasswordSetupRequired = owner.PasswordSetupRequired,
            CanRemove = false,
            Permissions = DeserializeMatrix(access?.PermissionMatrixJson),
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
        var permissions = NormalizeMatrix(request.Permissions ?? PropertyPermissionMatrixDefaults.CreateForRole(request.Role));
        access.PermissionMatrixJson = JsonSerializer.Serialize(permissions, JsonOptions);
    }


    private static IEnumerable<(string PermissionKey, bool IsAllowed)> MatrixToPermissionValues(
        PermissionMatrixDto matrix)
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

            yield return ($"{groupKey}.view", actions.View);
            yield return ($"{groupKey}.create", actions.Create);
            yield return ($"{groupKey}.edit", actions.Edit);
            yield return (
                groupKey == "bookings" ? "bookings.cancel" : $"{groupKey}.delete",
                actions.Delete);
            yield return ($"{groupKey}.export", actions.Export);
        }
    }

    private static PermissionMatrixDto DeserializeMatrix(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return NormalizeMatrix([]);
        }

        try
        {
            var matrix = JsonSerializer.Deserialize<PermissionMatrixDto>(
                value,
                JsonOptions);
            return matrix is null || matrix.Count == 0
                ? NormalizeMatrix([])
                : NormalizeMatrix(matrix);
        }
        catch (JsonException)
        {
            return NormalizeMatrix([]);
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

    private static readonly string[] PermissionGroups = PropertyPermissionMatrixDefaults.Groups;

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

    private static UserIdentityInput CreateUserIdentityFromFullName(
        string fullName,
        string phoneNumber,
        string? email)
    {
        var name = SplitFullName(fullName);
        var normalizedPhone = UserIdentityNormalization.NormalizePhoneNumber(phoneNumber)
            ?? throw new ArgumentException("Mobile number is required.");
        return new UserIdentityInput(
            UserIdentityNormalization.NormalizeName(name.FirstName),
            UserIdentityNormalization.NormalizeName(name.LastName),
            normalizedPhone,
            UserIdentityNormalization.NormalizeEmail(email));
    }

    private static string? CleanOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private async Task<List<User>> FindUsersByMobileAsync(
        string mobile,
        CancellationToken cancellationToken)
    {
        var variants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        return await dbContext.Users.IgnoreQueryFilters()
            .Where(user =>
                user.PhoneNumber != null &&
                variants.Contains(user.PhoneNumber))
            .OrderBy(user => user.Id)
            .ToListAsync(cancellationToken);
    }

    private static PropertyUserCandidateResponse UnavailableCandidate() => new()
    {
        Outcome = PropertyUserCandidateOutcome.Unavailable
    };

    private static InvalidOperationException CandidateUnavailableException() =>
        new("عملیات قابل انجام نیست.");

    private static string MaskName(User user)
    {
        static string MaskPart(string value)
        {
            var trimmed = value.Trim();
            return trimmed.Length == 0 ? string.Empty : $"{trimmed[0]}***";
        }

        return $"{MaskPart(user.FirstName)} {MaskPart(user.LastName)}".Trim();
    }
    private static bool NeedsPasswordSetup(User user) =>
        user.PasswordSetupRequired || string.IsNullOrWhiteSpace(user.PasswordHash);
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