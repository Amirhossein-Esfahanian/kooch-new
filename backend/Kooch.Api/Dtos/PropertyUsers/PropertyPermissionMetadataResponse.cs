using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.PropertyUsers;

public sealed class PropertyPermissionMetadataResponse
{
    public required IReadOnlyList<PropertyPermissionGroupMetadataResponse> Groups { get; init; }
    public required IReadOnlyList<PropertyPermissionActionMetadataResponse> Actions { get; init; }
    public required IReadOnlyDictionary<PropertyUserRole, PermissionMatrixDto> RoleDefaults { get; init; }
    public required PermissionMatrixDto ActorAssignablePermissions { get; init; }
}

public sealed class PropertyPermissionGroupMetadataResponse
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required IReadOnlyList<string> SupportedActions { get; init; }
}

public sealed class PropertyPermissionActionMetadataResponse
{
    public required string Key { get; init; }
    public required string Label { get; init; }
}
