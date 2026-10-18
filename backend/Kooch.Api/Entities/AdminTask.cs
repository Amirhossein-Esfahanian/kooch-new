namespace Kooch.Api.Entities;

public enum AdminTaskPriority { Low, Normal, High }
public enum AdminTaskStatus { Open, InProgress, Done, Cancelled }
public enum AdminTaskChangeType { Created, Reassigned, StatusChanged }

public class AdminTask : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public AdminTaskPriority Priority { get; set; } = AdminTaskPriority.Normal;
    public DateTime? DueAtUtc { get; set; }
    public int AssignedToUserId { get; set; }
    public int? ReservationId { get; set; }
    public AdminTaskStatus Status { get; set; } = AdminTaskStatus.Open;
    public string? ResolutionNote { get; set; }
    public DateTime? CompletedAtUtc { get; set; }

    public User CreatedByUser { get; set; } = null!;
    public User AssignedToUser { get; set; } = null!;
    public Reservation? Reservation { get; set; }
    public ICollection<AdminTaskChange> Changes { get; set; } = [];
}

public class AdminTaskChange : BaseEntity
{
    public int AdminTaskId { get; set; }
    public int ActorUserId { get; set; }
    public string ActorDisplayName { get; set; } = string.Empty;
    public AdminTaskChangeType ChangeType { get; set; }
    public DateTime OccurredAtUtc { get; set; }
    public AdminTaskStatus? PreviousStatus { get; set; }
    public AdminTaskStatus? NewStatus { get; set; }
    public int? PreviousAssigneeUserId { get; set; }
    public int? NewAssigneeUserId { get; set; }
    public string? ResolutionNote { get; set; }

    public AdminTask AdminTask { get; set; } = null!;
    public User ActorUser { get; set; } = null!;
}
