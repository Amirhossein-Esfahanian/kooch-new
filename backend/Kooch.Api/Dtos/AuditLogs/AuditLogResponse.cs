using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.AuditLogs;

public class AuditLogResponse
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string User { get; set; } = string.Empty;
    public AuditAction Action { get; set; }
    public int? PropertyId { get; set; }
    public string? Property { get; set; }
    public DateTime Time { get; set; }
    public string Entity { get; set; } = string.Empty;
    public int? EntityId { get; set; }
    public string? EntityName { get; set; }
    public string? Description { get; set; }
}
