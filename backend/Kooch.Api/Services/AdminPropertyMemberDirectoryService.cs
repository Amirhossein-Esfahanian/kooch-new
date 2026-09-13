using System.Data;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AdminPropertyMemberDirectoryService(
    KoochDbContext dbContext,
    PropertyAccessService propertyAccessService,
    IPermissionService permissionService,
    IAuditLogService auditLogService) : IAdminPropertyMemberDirectoryService
{
    public async Task<AdminPropertyMemberIdentityResponse> UpdateIdentityAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        AdminPropertyMemberIdentityUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;

        var visiblePropertyIds = await GetVisiblePropertyIdsAsync(
            currentUserId,
            currentRole,
            cancellationToken);
        var targetIsVisible = visiblePropertyIds.Count > 0 &&
            await BuildVisibleMembershipQuery(visiblePropertyIds)
                .AnyAsync(item => item.UserId == userId, cancellationToken);
        if (!targetIsVisible)
        {
            throw new UnauthorizedAccessException("You cannot edit this property member.");
        }

        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(
                item => item.Id == userId && !item.IsDeleted,
                cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
        if (user.Role.IsPlatformAdmin())
        {
            throw new InvalidOperationException(
                "Platform administrators must be edited through Admin Users.");
        }

        var firstName = NormalizeRequiredName(request.FirstName, "First name");
        var lastName = NormalizeRequiredName(request.LastName, "Last name");
        var phoneNumber = UserIdentityNormalization.NormalizePhoneNumber(request.PhoneNumber)
            ?? throw new ArgumentException("Mobile number is required.");
        var email = UserIdentityNormalization.NormalizeEmail(request.Email);
        var currentPhoneNumber = UserIdentityNormalization.NormalizePhoneNumber(user.PhoneNumber);
        var currentEmail = UserIdentityNormalization.NormalizeEmail(user.Email);
        var phoneChanged = !string.Equals(currentPhoneNumber, phoneNumber, StringComparison.Ordinal);
        var emailChanged = !string.Equals(currentEmail, email, StringComparison.Ordinal);
        await EnsureUniqueIdentityAsync(
            email,
            emailChanged,
            phoneNumber,
            phoneChanged,
            user.Id,
            cancellationToken);

        var changedFields = new List<string>();
        AddChangedField(changedFields, nameof(User.FirstName), user.FirstName, firstName);
        AddChangedField(changedFields, nameof(User.LastName), user.LastName, lastName);
        AddChangedField(changedFields, nameof(User.PhoneNumber), user.PhoneNumber, phoneNumber);
        AddChangedField(changedFields, nameof(User.Email), user.Email, email);
        var contactChanged = phoneChanged || emailChanged;

        user.FirstName = firstName;
        user.LastName = lastName;
        user.PhoneNumber = phoneNumber;
        user.Email = email;
        if (contactChanged)
        {
            user.SecurityStampVersion++;
        }

        auditLogService.Add(
            currentUserId,
            AuditAction.PropertyMemberIdentityUpdated,
            nameof(User),
            user.Id,
            entityName: $"{firstName} {lastName}".Trim(),
            description: changedFields.Count == 0
                ? "Property member identity update requested with no changes."
                : $"Property member identity updated: {string.Join(", ", changedFields)}.");
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return new AdminPropertyMemberIdentityResponse
        {
            Id = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            PhoneNumber = user.PhoneNumber ?? string.Empty,
            Email = user.Email
        };
    }

    public async Task<PagedResult<AdminPropertyMemberDirectoryResponse>> SearchAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyMemberDirectoryQuery request,
        CancellationToken cancellationToken = default)
    {
        var visiblePropertyIds = await GetVisiblePropertyIdsAsync(
            currentUserId,
            currentRole,
            cancellationToken);
        if (visiblePropertyIds.Count == 0)
        {
            return EmptyResult(request);
        }

        var visibleMemberships = BuildVisibleMembershipQuery(visiblePropertyIds);
        var matchingMemberships = visibleMemberships;
        if (request.PropertyId.HasValue)
        {
            matchingMemberships = matchingMemberships.Where(item => item.PropertyId == request.PropertyId.Value);
        }

        if (request.Role.HasValue)
        {
            matchingMemberships = matchingMemberships.Where(item => item.Role == request.Role.Value);
        }

        if (request.Status.HasValue)
        {
            matchingMemberships = matchingMemberships.Where(item => item.Status == request.Status.Value);
        }

        var matchingUserIds = matchingMemberships.Select(item => item.UserId).Distinct();
        var users = dbContext.Users.AsNoTracking()
            .Where(user => matchingUserIds.Contains(user.Id));

        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            users = users.Where(user =>
                user.FirstName.Contains(search) ||
                user.LastName.Contains(search) ||
                (user.PhoneNumber != null && user.PhoneNumber.Contains(search)) ||
                (user.Email != null && user.Email.Contains(search)));
        }

        var totalCount = await users.CountAsync(cancellationToken);
        var pageUsers = await users
            .OrderBy(user => user.LastName)
            .ThenBy(user => user.FirstName)
            .ThenBy(user => user.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(user => new AdminPropertyMemberDirectoryResponse
            {
                Id = user.Id,
                FirstName = user.FirstName,
                LastName = user.LastName,
                PhoneNumber = user.PhoneNumber,
                Email = user.Email,
                IsActive = user.IsActive
            })
            .ToListAsync(cancellationToken);

        var pageUserIds = pageUsers.Select(user => user.Id).ToArray();
        if (pageUserIds.Length > 0)
        {
            var pageMemberships = await BuildVisibleMembershipQuery(visiblePropertyIds)
                .Where(item => pageUserIds.Contains(item.UserId))
                .OrderBy(item => item.PropertyName)
                .ThenBy(item => item.PropertyId)
                .ToListAsync(cancellationToken);
            var membershipsByUser = pageMemberships.ToLookup(item => item.UserId);

            foreach (var user in pageUsers)
            {
                user.Memberships = membershipsByUser[user.Id]
                    .Select(item => new AdminPropertyMembershipResponse
                    {
                        PropertyId = item.PropertyId,
                        PropertyName = item.PropertyName,
                        Role = item.Role,
                        Status = item.Status,
                        IsActive = item.IsActive,
                        IsOwner = item.IsOwner
                    })
                    .ToArray();
            }
        }

        return new PagedResult<AdminPropertyMemberDirectoryResponse>
        {
            Items = pageUsers,
            TotalCount = totalCount,
            Page = request.Page,
            PageSize = request.PageSize,
            TotalPages = totalCount == 0
                ? 0
                : (int)Math.Ceiling(totalCount / (double)request.PageSize)
        };
    }

    public async Task<PagedResult<AdminPropertyMemberPropertyOptionResponse>> SearchPropertiesAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyMemberPropertyOptionQuery request,
        CancellationToken cancellationToken = default)
    {
        var visiblePropertyIds = await GetVisiblePropertyIdsAsync(
            currentUserId,
            currentRole,
            cancellationToken);
        if (visiblePropertyIds.Count == 0)
        {
            return new PagedResult<AdminPropertyMemberPropertyOptionResponse>
            {
                Page = request.Page,
                PageSize = request.PageSize
            };
        }

        var properties = dbContext.Properties.AsNoTracking()
            .Where(property => visiblePropertyIds.Contains(property.Id));
        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            properties = properties.Where(property => property.Name.Contains(search));
        }

        var totalCount = await properties.CountAsync(cancellationToken);
        var items = await properties
            .OrderBy(property => property.Name)
            .ThenBy(property => property.Id)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(property => new AdminPropertyMemberPropertyOptionResponse
            {
                Id = property.Id,
                Name = property.Name
            })
            .ToListAsync(cancellationToken);

        return new PagedResult<AdminPropertyMemberPropertyOptionResponse>
        {
            Items = items,
            TotalCount = totalCount,
            Page = request.Page,
            PageSize = request.PageSize,
            TotalPages = totalCount == 0
                ? 0
                : (int)Math.Ceiling(totalCount / (double)request.PageSize)
        };
    }

    private async Task<IReadOnlyList<int>> GetVisiblePropertyIdsAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken)
    {
        if (currentRole is not UserRole.SuperAdmin and not UserRole.AdminAssistant ||
            !await permissionService.HasPermissionAsync(
                currentUserId,
                PermissionKey.ManageUsers,
                cancellationToken: cancellationToken))
        {
            throw new UnauthorizedAccessException("ManageUsers permission is required.");
        }

        return await propertyAccessService.GetPropertyIdsWithPermissionAsync(
            currentUserId,
            "users.view",
            cancellationToken);
    }

    private IQueryable<VisibleMembership> BuildVisibleMembershipQuery(
        IReadOnlyCollection<int> visiblePropertyIds)
    {
        var ownerMemberships =
            from property in dbContext.Properties.AsNoTracking()
            where visiblePropertyIds.Contains(property.Id)
            join ownerAccess in dbContext.UserPropertyAccesses.AsNoTracking()
                    .Where(access => access.PropertyRole == PropertyUserRole.PropertyOwner)
                on new { UserId = property.OwnerId, PropertyId = property.Id }
                equals new { ownerAccess.UserId, ownerAccess.PropertyId }
                into ownerAccesses
            from ownerAccess in ownerAccesses.DefaultIfEmpty()
            select new VisibleMembership
            {
                UserId = property.OwnerId,
                PropertyId = property.Id,
                PropertyName = property.Name,
                Role = PropertyUserRole.PropertyOwner,
                Status = ownerAccess == null ? PropertyUserStatus.Inactive : ownerAccess.Status,
                IsActive = ownerAccess != null && ownerAccess.IsActive,
                IsOwner = true
            };

        var staffMemberships = dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access =>
                visiblePropertyIds.Contains(access.PropertyId) &&
                access.UserId != access.Property.OwnerId)
            .Select(access => new VisibleMembership
            {
                UserId = access.UserId,
                PropertyId = access.PropertyId,
                PropertyName = access.Property.Name,
                Role = access.PropertyRole,
                Status = access.Status,
                IsActive = access.IsActive,
                IsOwner = false
            });

        return ownerMemberships.Concat(staffMemberships);
    }

    private static PagedResult<AdminPropertyMemberDirectoryResponse> EmptyResult(
        AdminPropertyMemberDirectoryQuery request) => new()
    {
        Page = request.Page,
        PageSize = request.PageSize
    };

    private async Task EnsureUniqueIdentityAsync(
        string? email,
        bool emailChanged,
        string phoneNumber,
        bool phoneChanged,
        int targetUserId,
        CancellationToken cancellationToken)
    {
        if (emailChanged && email is not null && await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email && user.Id != targetUserId, cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicateEmailMessage);
        }

        if (phoneChanged)
        {
            var phoneNumberVariants = UserIdentityNormalization.BuildPhoneNumberVariants(phoneNumber);
            if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user =>
                    user.PhoneNumber != null &&
                    phoneNumberVariants.Contains(user.PhoneNumber) &&
                    user.Id != targetUserId,
                    cancellationToken))
            {
                throw new ArgumentException(UserIdentityNormalization.DuplicatePhoneNumberMessage);
            }
        }

        var checkEmailAgainstGuests = emailChanged && email is not null;
        if ((checkEmailAgainstGuests || phoneChanged) && await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest =>
                    (guest.UserId == null || guest.UserId != targetUserId) &&
                    ((checkEmailAgainstGuests && guest.NormalizedEmail == email) ||
                     (phoneChanged && guest.NormalizedMobile == phoneNumber)),
                    cancellationToken))
        {
            throw new ArgumentException("Guest with this mobile or email already exists.");
        }
    }

    private static string NormalizeRequiredName(string value, string fieldName)
    {
        var normalized = UserIdentityNormalization.NormalizeName(value);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ArgumentException($"{fieldName} is required.");
        }

        return normalized;
    }

    private static void AddChangedField(
        ICollection<string> changedFields,
        string fieldName,
        string? before,
        string? after)
    {
        if (!string.Equals(before, after, StringComparison.Ordinal))
        {
            changedFields.Add(fieldName);
        }
    }

    private sealed class VisibleMembership
    {
        public int UserId { get; init; }
        public int PropertyId { get; init; }
        public string PropertyName { get; init; } = string.Empty;
        public PropertyUserRole Role { get; init; }
        public PropertyUserStatus Status { get; init; }
        public bool IsActive { get; init; }
        public bool IsOwner { get; init; }
    }
}
