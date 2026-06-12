namespace Kooch.Api.Entities;

public abstract class BaseEntity
{
    public int Id { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public int? CreatedByUserId { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
    public int? UpdatedByUserId { get; set; }
    public DateTime? DeletedAtUtc { get; set; }
    public int? DeletedByUserId { get; set; }
    public bool IsDeleted { get; set; }
}
