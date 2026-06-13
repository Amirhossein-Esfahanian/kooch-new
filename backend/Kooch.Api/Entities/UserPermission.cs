namespace Kooch.Api.Entities;

public class UserPermission : BaseEntity
{
    public int UserId { get; set; }
    public PermissionKey PermissionKey { get; set; }
    public bool IsAllowed { get; set; }
    public int? PropertyId { get; set; }

    public User User { get; set; } = null!;
    public Permission Permission { get; set; } = null!;
    public Property? Property { get; set; }
}
