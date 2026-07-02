using Kooch.Api.Data;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class AuditLogService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IAuditLogService
{
    public void Add(
        int userId,
        AuditAction action,
        string entityType,
        int? entityId = null,
        int? propertyId = null,
        string? entityName = null,
        string? description = null)
    {
        dbContext.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            PropertyId = propertyId,
            EntityName = CleanOptional(entityName),
            Description = CleanOptional(description),
            OccurredAtUtc = DateTime.UtcNow
        });
    }

    public async Task<IReadOnlyList<AuditLogResponse>> GetByPropertyAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot view audit logs for this property.");
        }

        return await dbContext.AuditLogs.AsNoTracking()
            .Where(log => log.PropertyId == propertyId)
            .OrderByDescending(log => log.OccurredAtUtc)
            .ThenByDescending(log => log.Id)
            .Take(300)
            .Select(log => new AuditLogResponse
            {
                Id = log.Id,
                UserId = log.UserId,
                User = (log.User.FirstName + " " + log.User.LastName).Trim() == ""
                    ? log.User.Email
                    : (log.User.FirstName + " " + log.User.LastName).Trim(),
                Action = log.Action,
                PropertyId = log.PropertyId,
                Property = log.Property == null ? null : log.Property.Name,
                Time = log.OccurredAtUtc,
                Entity = log.EntityType,
                EntityId = log.EntityId,
                EntityName = log.EntityName,
                Description = log.Description
            })
            .ToListAsync(cancellationToken);
    }

    private static string? CleanOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
