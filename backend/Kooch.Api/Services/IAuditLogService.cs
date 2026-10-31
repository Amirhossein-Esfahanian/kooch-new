using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Entities;
using Kooch.Api.Dtos.Reservations;

namespace Kooch.Api.Services;

public interface IAuditLogService
{
    void RecordInventoryChanges(int userId, int propertyId, IReadOnlyCollection<int> authorizedRoomTypeIds) => throw new NotSupportedException();
    void RecordPriceChanges(int userId, int propertyId, IReadOnlyCollection<RoomDailyPriceHistory> history,
        IReadOnlyDictionary<int, string> roomNames) => throw new NotSupportedException();
    Task<AdminPriceChangePage> GetPriceChangesForAdminAsync(int userId, int auditLogId,
        AdminPriceChangeQuery query, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    Task<PagedResult<AdminAuditLogResponse>> GetForAdminAsync(
        int userId, AdminAuditLogQuery query, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

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
