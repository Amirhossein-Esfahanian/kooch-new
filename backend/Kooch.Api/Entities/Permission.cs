namespace Kooch.Api.Entities;

public class Permission : BaseEntity
{
    public PermissionKey Key { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    public ICollection<UserPermission> UserPermissions { get; set; } = [];
}
