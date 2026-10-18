using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.AdminTasks;

public sealed record CreateAdminTaskRequest(
    string? Title, string? Description, AdminTaskPriority Priority, DateTime? DueAtUtc,
    int AssignedToUserId, int? ReservationId);

public sealed record ReassignAdminTaskRequest(int AssignedToUserId);
public sealed record UpdateAdminTaskStatusRequest(AdminTaskStatus Status, string? ResolutionNote);

public sealed record AdminTaskChangeResponse(
    int Id, int ActorUserId, string ActorDisplayName, AdminTaskChangeType ChangeType,
    DateTime OccurredAtUtc, AdminTaskStatus? PreviousStatus, AdminTaskStatus? NewStatus,
    int? PreviousAssigneeUserId, int? NewAssigneeUserId, string? ResolutionNote);

public sealed record AdminTaskResponse(
    int Id, string Title, string? Description, AdminTaskPriority Priority, DateTime? DueAtUtc,
    int CreatedByUserId, int AssignedToUserId, int? ReservationId, AdminTaskStatus Status,
    string? ResolutionNote, DateTime CreatedAtUtc, DateTime? UpdatedAtUtc, DateTime? CompletedAtUtc,
    IReadOnlyList<AdminTaskChangeResponse> Changes);
