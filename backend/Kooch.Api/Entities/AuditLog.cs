namespace Kooch.Api.Entities;

public class AuditLog : BaseEntity
{
    public int UserId { get; set; }
    public int? PropertyId { get; set; }
    public AuditAction Action { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public int? EntityId { get; set; }
    public string? EntityName { get; set; }
    public string? Description { get; set; }
    public DateTime OccurredAtUtc { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
    public Property? Property { get; set; }
}
