using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAuditLogService
{
    void Add(
        int userId,
        AuditAction action,
        string entityType,
        int? entityId = null,
        int? propertyId = null,
        string? entityName = null,
        string? description = null);

    Task<IReadOnlyList<AuditLogResponse>> GetByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default);
}
