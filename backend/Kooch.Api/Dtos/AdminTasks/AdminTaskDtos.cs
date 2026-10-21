using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.AdminTasks;

public sealed record CreateAdminTaskRequest(
    string? Title, string? Description, AdminTaskPriority Priority, DateTime? DueAtUtc,
    int AssignedToUserId, int? ReservationId);

public sealed record ReassignAdminTaskRequest(int AssignedToUserId);
public sealed record AdminTaskAssigneeResponse(int Id, string DisplayName);
public sealed record AdminTaskUnfinishedItemResponse(
    int Id, string Title, AdminTaskPriority Priority, AdminTaskStatus Status, DateTime? DueAtUtc);
public sealed class AdminTaskUnfinishedQuery
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 5;
}
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
