namespace Kooch.Api.Entities;

public class UserPropertyAccess : BaseEntity
{
    public int UserId { get; set; }
    public int PropertyId { get; set; }
    public PropertyUserStatus Status { get; set; } = PropertyUserStatus.Active;
    public PropertyUserRole PropertyRole { get; set; } = PropertyUserRole.Manager;
    public string PermissionMatrixJson { get; set; } = "{}";
    public bool IsActive { get; set; } = true;

    public User User { get; set; } = null!;
    public Property Property { get; set; } = null!;
}
