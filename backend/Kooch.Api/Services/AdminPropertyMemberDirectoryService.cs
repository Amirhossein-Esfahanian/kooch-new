using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AdminPropertyMemberDirectoryService(
    KoochDbContext dbContext,
    PropertyAccessService propertyAccessService,
    IPermissionService permissionService) : IAdminPropertyMemberDirectoryService
{
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
