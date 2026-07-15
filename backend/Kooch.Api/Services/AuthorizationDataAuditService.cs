using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public interface IAuthorizationDataAuditService
{
    Task<AuthorizationDataAuditReport> CreateReportAsync(
        CancellationToken cancellationToken = default);
}

public sealed class AuthorizationDataAuditService(KoochDbContext dbContext)
    : IAuthorizationDataAuditService
{
    public async Task<AuthorizationDataAuditReport> CreateReportAsync(
        CancellationToken cancellationToken = default)
    {
        var users = await dbContext.Users.AsNoTracking()
            .Select(user => new UserSnapshot(
                user.Id,
                (user.FirstName + " " + user.LastName).Trim(),
                user.Role,
                user.IsActive))
            .ToListAsync(cancellationToken);
        var properties = await dbContext.Properties.AsNoTracking()
            .Select(property => new PropertySnapshot(
                property.Id,
                property.Name,
                property.OwnerId))
            .ToListAsync(cancellationToken);
        var memberships = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Select(access => new MembershipSnapshot(
                access.Id,
                access.UserId,
                access.PropertyId,
                access.PropertyRole,
                access.Status,
                access.IsActive,
                access.IsDeleted,
                access.PermissionMatrixJson))
            .ToListAsync(cancellationToken);

        var usersById = users.ToDictionary(user => user.Id);
        var propertiesById = properties.ToDictionary(property => property.Id);
        var currentMemberships = memberships.Where(membership => !membership.IsDeleted).ToList();
        var sections = new List<AuthorizationDataAuditSection>
        {
            BuildMissingOwnerMembershipSection(properties, currentMemberships, usersById),
            BuildConflictingOwnerMembershipSection(properties, currentMemberships, usersById),
            BuildInvalidPermissionMatrixSection(currentMemberships, usersById, propertiesById),
            BuildInactiveUserActiveMembershipSection(usersById, currentMemberships, propertiesById),
            BuildActiveUserSuspendedMembershipSection(usersById, currentMemberships, propertiesById),
            BuildDuplicateMembershipSection(currentMemberships, usersById, propertiesById),
            BuildDeletedOwnerMembershipSection(properties, memberships, usersById),
            BuildLegacyGlobalRoleSection(users),
            BuildMultiplePropertiesSection(currentMemberships, usersById, propertiesById)
        };

        return new AuthorizationDataAuditReport(DateTime.UtcNow, sections);
    }

    private static AuthorizationDataAuditSection BuildMissingOwnerMembershipSection(
        IReadOnlyCollection<PropertySnapshot> properties,
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById)
    {
        var items = properties
            .Where(property => !memberships.Any(membership =>
                membership.UserId == property.OwnerId &&
                membership.PropertyId == property.Id &&
                membership.PropertyRole == PropertyUserRole.PropertyOwner &&
                membership.IsActive &&
                membership.Status == PropertyUserStatus.Active))
            .Select(property =>
                $"Property {DescribeProperty(property)} has OwnerId={property.OwnerId} " +
                $"({DescribeUser(usersById, property.OwnerId)}) without a matching active membership.")
            .ToList();

        return Section(
            "property-owner-without-active-membership",
            "Property.OwnerId without active PropertyOwner membership",
            items);
    }

    private static AuthorizationDataAuditSection BuildConflictingOwnerMembershipSection(
        IReadOnlyCollection<PropertySnapshot> properties,
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById)
    {
        var items = properties
            .Select(property => new
            {
                Property = property,
                Conflicts = memberships
                    .Where(membership =>
                        membership.PropertyId == property.Id &&
                        membership.UserId != property.OwnerId &&
                        membership.PropertyRole == PropertyUserRole.PropertyOwner &&
                        membership.IsActive &&
                        membership.Status == PropertyUserStatus.Active)
                    .ToList()
            })
            .Where(result => result.Conflicts.Count > 0)
            .Select(result =>
                $"Property {DescribeProperty(result.Property)} has OwnerId={result.Property.OwnerId}, but also has " +
                $"active PropertyOwner membership(s): " +
                string.Join(", ", result.Conflicts.Select(membership =>
                    $"#{membership.Id}/{DescribeUser(usersById, membership.UserId)}")) + ".")
            .ToList();

        return Section(
            "conflicting-active-property-owner-membership",
            "Conflicting active PropertyOwner memberships",
            items);
    }

    private static AuthorizationDataAuditSection BuildDeletedOwnerMembershipSection(
        IReadOnlyCollection<PropertySnapshot> properties,
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById)
    {
        var propertiesById = properties.ToDictionary(property => property.Id);
        var items = memberships
            .Where(membership =>
                membership.IsDeleted &&
                membership.PropertyRole == PropertyUserRole.PropertyOwner &&
                propertiesById.TryGetValue(membership.PropertyId, out var property) &&
                property.OwnerId == membership.UserId)
            .Select(membership =>
                $"Deleted owner membership #{membership.Id} links {DescribeUser(usersById, membership.UserId)} to " +
                $"{DescribeProperty(propertiesById[membership.PropertyId])} " +
                $"(status={membership.Status}, isActive={membership.IsActive}).")
            .ToList();

        return Section(
            "deleted-owner-membership",
            "Deleted owner memberships",
            items);
    }

    private static AuthorizationDataAuditSection BuildLegacyGlobalRoleSection(
        IReadOnlyCollection<UserSnapshot> users)
    {
        var items = users
            .Where(user => user.Role is UserRole.Owner or UserRole.OwnerAssistant)
            .Select(user => $"User {DescribeUser(user)} still has legacy global role {user.Role}.")
            .ToList();

        return InformationSection(
            "legacy-property-global-role",
            "Legacy Owner/OwnerAssistant global roles",
            items);
    }

    private static AuthorizationDataAuditSection BuildInvalidPermissionMatrixSection(
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById)
    {
        var items = memberships
            .Select(membership => (Membership: membership, Error: ValidatePermissionMatrix(membership.PermissionMatrixJson)))
            .Where(result => result.Error is not null)
            .Select(result =>
                $"Membership #{result.Membership.Id} for {DescribeUser(usersById, result.Membership.UserId)} " +
                $"and {DescribeProperty(propertiesById, result.Membership.PropertyId)}: {result.Error}.")
            .ToList();

        return Section(
            "invalid-permission-matrix",
            "Invalid or empty PermissionMatrixJson",
            items);
    }

    private static AuthorizationDataAuditSection BuildInactiveUserActiveMembershipSection(
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById)
    {
        var items = memberships
            .Where(membership =>
                membership.IsActive &&
                membership.Status == PropertyUserStatus.Active &&
                usersById.TryGetValue(membership.UserId, out var user) &&
                !user.IsActive)
            .Select(membership =>
                $"Inactive user {DescribeUser(usersById[membership.UserId])} has active membership #{membership.Id} " +
                $"for {DescribeProperty(propertiesById, membership.PropertyId)}.")
            .ToList();

        return Section(
            "inactive-user-active-membership",
            "Inactive User with active property membership",
            items);
    }

    private static AuthorizationDataAuditSection BuildActiveUserSuspendedMembershipSection(
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById)
    {
        var items = memberships
            .Where(membership =>
                membership.Status == PropertyUserStatus.Suspended &&
                usersById.TryGetValue(membership.UserId, out var user) &&
                user.IsActive)
            .Select(membership =>
                $"Active user {DescribeUser(usersById[membership.UserId])} has suspended membership #{membership.Id} " +
                $"for {DescribeProperty(propertiesById, membership.PropertyId)} " +
                $"(isActive={membership.IsActive}).")
            .ToList();

        return Section(
            "active-user-suspended-membership",
            "Active User with suspended membership",
            items);
    }

    private static AuthorizationDataAuditSection BuildDuplicateMembershipSection(
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById)
    {
        var items = memberships
            .GroupBy(membership => new { membership.UserId, membership.PropertyId })
            .Where(group => group.Count() > 1)
            .Select(group =>
                $"{DescribeUser(usersById, group.Key.UserId)} has {group.Count()} memberships for " +
                $"{DescribeProperty(propertiesById, group.Key.PropertyId)}: " +
                string.Join(", ", group.Select(item => $"#{item.Id}/{item.Status}/active={item.IsActive}")) + ".")
            .ToList();

        return Section(
            "duplicate-property-membership",
            "Duplicate memberships for the same user/property",
            items);
    }

    private static AuthorizationDataAuditSection BuildMultiplePropertiesSection(
        IReadOnlyCollection<MembershipSnapshot> memberships,
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById)
    {
        var items = memberships
            .Where(membership => membership.Status != PropertyUserStatus.Inactive)
            .GroupBy(membership => membership.UserId)
            .Select(group => new
            {
                UserId = group.Key,
                PropertyIds = group.Select(item => item.PropertyId).Distinct().ToList()
            })
            .Where(group => group.PropertyIds.Count > 1)
            .Select(group =>
                $"{DescribeUser(usersById, group.UserId)} is assigned to {group.PropertyIds.Count} properties: " +
                string.Join(", ", group.PropertyIds.Select(id => DescribeProperty(propertiesById, id))) + ".")
            .ToList();

        return InformationSection(
            "user-with-multiple-properties",
            "Users assigned to multiple properties",
            items);
    }

    private static string? ValidatePermissionMatrix(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "empty value";
        }

        try
        {
            var matrix = JsonSerializer.Deserialize<PermissionMatrixDto>(value, JsonOptions);
            if (matrix is null || matrix.Count == 0)
            {
                return "empty JSON object";
            }

            var invalidGroup = matrix.Keys.FirstOrDefault(group => !PermissionGroups.Contains(group));
            return invalidGroup is null
                ? null
                : $"unknown permission group '{invalidGroup}'";
        }
        catch (JsonException exception)
        {
            return $"invalid JSON ({exception.Message.Split(Environment.NewLine)[0]})";
        }
    }

    private static AuthorizationDataAuditSection Section(
        string code,
        string title,
        IReadOnlyList<string> items) =>
        new(code, title, items);

    private static AuthorizationDataAuditSection InformationSection(
        string code,
        string title,
        IReadOnlyList<string> items) =>
        new(code, title, items, IsInformational: true);

    private static string DescribeUser(UserSnapshot user) =>
        $"#{user.Id} '{user.Name}' ({user.Role}, active={user.IsActive})";

    private static string DescribeUser(
        IReadOnlyDictionary<int, UserSnapshot> usersById,
        int userId) =>
        usersById.TryGetValue(userId, out var user)
            ? DescribeUser(user)
            : $"#{userId} '<missing user>'";

    private static string DescribeProperty(PropertySnapshot property) =>
        $"#{property.Id} '{property.Name}'";

    private static string DescribeProperty(
        IReadOnlyDictionary<int, PropertySnapshot> propertiesById,
        int propertyId) =>
        propertiesById.TryGetValue(propertyId, out var property)
            ? DescribeProperty(property)
            : $"#{propertyId} '<missing property>'";

    private sealed record UserSnapshot(int Id, string Name, UserRole Role, bool IsActive);
    private sealed record PropertySnapshot(int Id, string Name, int OwnerId);
    private sealed record MembershipSnapshot(
        int Id,
        int UserId,
        int PropertyId,
        PropertyUserRole PropertyRole,
        PropertyUserStatus Status,
        bool IsActive,
        bool IsDeleted,
        string? PermissionMatrixJson);

    private static readonly HashSet<string> PermissionGroups =
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

public sealed record AuthorizationDataAuditSection(
    string Code,
    string Title,
    IReadOnlyList<string> Items,
    bool IsInformational = false)
{
    public int Count => Items.Count;
}

public sealed record AuthorizationDataAuditReport(
    DateTime GeneratedAtUtc,
    IReadOnlyList<AuthorizationDataAuditSection> Sections)
{
    public bool HasFindings => Sections.Any(section => !section.IsInformational && section.Count > 0);
    public int TotalFindings => Sections
        .Where(section => !section.IsInformational)
        .Sum(section => section.Count);
    public int TotalInformationItems => Sections
        .Where(section => section.IsInformational)
        .Sum(section => section.Count);

    public string ToReadableText()
    {
        var builder = new StringBuilder();
        builder.AppendLine("Kooch authorization data audit");
        builder.AppendLine($"Generated at (UTC): {GeneratedAtUtc:O}");
        builder.AppendLine("Read-only report: no data was modified.");
        builder.AppendLine($"Total findings: {TotalFindings}");
        builder.AppendLine($"Informational items: {TotalInformationItems}");

        foreach (var section in Sections)
        {
            builder.AppendLine();
            var sectionKind = section.IsInformational ? "INFO" : "CHECK";
            builder.AppendLine($"[{sectionKind}: {section.Count}] {section.Title}");
            if (section.Count == 0)
            {
                builder.AppendLine("  OK");
                continue;
            }

            foreach (var item in section.Items)
            {
                builder.AppendLine($"  - {item}");
            }
        }

        return builder.ToString();
    }
}
