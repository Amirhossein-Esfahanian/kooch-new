using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Dtos.AdminTasks;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class AdminTaskService(
    KoochDbContext context, IPermissionService permissions, ReservationActivityService activities)
{
    public async Task<IReadOnlyList<AdminTaskAssigneeResponse>> ListAssigneesAsync(
        int actorUserId, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        var users = await ActiveAdminUsers().OrderBy(user => user.LastName)
            .ThenBy(user => user.FirstName).ThenBy(user => user.Id)
            .Select(user => new { user.Id, user.FirstName, user.LastName, user.Username, user.Email })
            .ToListAsync(cancellationToken);
        return users.Select(user =>
        {
            var name = $"{user.FirstName} {user.LastName}".Trim();
            if (name.Length == 0) name = user.Username?.Trim() ?? string.Empty;
            if (name.Length == 0) name = user.Email?.Trim() ?? string.Empty;
            if (name.Length == 0) name = $"Admin {user.Id}";
            return new AdminTaskAssigneeResponse(user.Id, name);
        }).ToArray();
    }

    public async Task<IReadOnlyList<AdminTaskResponse>> ListAsync(int actorUserId, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        var tasks = await context.AdminTasks.AsNoTracking()
            .OrderByDescending(task => task.CreatedAtUtc).ThenByDescending(task => task.Id)
            .ToListAsync(cancellationToken);
        var reservationIds = tasks.Where(task => task.ReservationId.HasValue)
            .Select(task => task.ReservationId!.Value).Distinct().ToArray();
        var reservationProperties = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(row => reservationIds.Contains(row.Id))
            .ToDictionaryAsync(row => row.Id, row => row.PropertyId, cancellationToken);
        var allowedProperties = new Dictionary<int, bool>();
        var visible = new List<AdminTaskResponse>();
        foreach (var task in tasks)
        {
            if (task.ReservationId.HasValue)
            {
                if (!reservationProperties.TryGetValue(task.ReservationId.Value, out var propertyId)) continue;
                if (!allowedProperties.TryGetValue(propertyId, out var allowed))
                {
                    allowed = await permissions.CanAsync(actorUserId, propertyId, "bookings.view", cancellationToken);
                    allowedProperties.Add(propertyId, allowed);
                }
                if (!allowed) continue;
            }
            visible.Add(Map(task, []));
        }
        return visible;
    }

    public async Task<AdminTaskResponse> GetAsync(int actorUserId, int id, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        var task = await context.AdminTasks.AsNoTracking()
            .Include(row => row.Changes)
            .SingleOrDefaultAsync(row => row.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Admin task not found.");
        await RequireReservationPermissionAsync(actorUserId, task.ReservationId, "bookings.view", cancellationToken);
        return Map(task, task.Changes.OrderBy(row => row.OccurredAtUtc).ThenBy(row => row.Id).ToArray());
    }

    public async Task<AdminTaskResponse> CreateAsync(
        int actorUserId, CreateAdminTaskRequest request, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        var title = Required(request.Title, 250, nameof(request.Title));
        var description = Optional(request.Description, 4000, nameof(request.Description));
        if (!Enum.IsDefined(request.Priority)) throw new ArgumentOutOfRangeException(nameof(request.Priority));
        var actorName = await ActorNameAsync(actorUserId, cancellationToken);
        await RequireAdminAssigneeAsync(request.AssignedToUserId, cancellationToken);
        if (request.ReservationId.HasValue && !await context.Reservations.AsNoTracking()
                .AnyAsync(row => row.Id == request.ReservationId.Value, cancellationToken))
            throw new KeyNotFoundException("Reservation not found.");
        await RequireReservationPermissionAsync(actorUserId, request.ReservationId, "bookings.edit", cancellationToken);

        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;
        var now = DateTime.UtcNow;
        var task = new AdminTask
        {
            Title = title, Description = description, Priority = request.Priority,
            DueAtUtc = request.DueAtUtc, AssignedToUserId = request.AssignedToUserId,
            ReservationId = request.ReservationId, Status = AdminTaskStatus.Open,
            CreatedByUserId = actorUserId
        };
        task.Changes.Add(new AdminTaskChange
        {
            ActorUserId = actorUserId, ActorDisplayName = actorName,
            ChangeType = AdminTaskChangeType.Created, OccurredAtUtc = now,
            NewStatus = AdminTaskStatus.Open, NewAssigneeUserId = request.AssignedToUserId,
            CreatedByUserId = actorUserId
        });
        context.AdminTasks.Add(task);
        await context.SaveChangesAsync(cancellationToken);
        if (task.ReservationId.HasValue)
            await AppendActivityAsync(task, actorUserId, "AdminTaskCreated", "وظیفه ایجاد شد", cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(task, task.Changes.OrderBy(row => row.OccurredAtUtc).ThenBy(row => row.Id).ToArray());
    }

    public async Task<AdminTaskResponse> ReassignAsync(
        int actorUserId, int id, ReassignAdminTaskRequest request, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        var actorName = await ActorNameAsync(actorUserId, cancellationToken);
        await RequireAdminAssigneeAsync(request.AssignedToUserId, cancellationToken);
        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;
        var task = await GetForWriteAsync(actorUserId, id, cancellationToken);
        if (task.AssignedToUserId == request.AssignedToUserId)
            throw new ArgumentException("The task is already assigned to this user.");
        var previous = task.AssignedToUserId;
        task.AssignedToUserId = request.AssignedToUserId;
        task.UpdatedByUserId = actorUserId;
        task.Changes.Add(new AdminTaskChange
        {
            ActorUserId = actorUserId, ActorDisplayName = actorName,
            ChangeType = AdminTaskChangeType.Reassigned, OccurredAtUtc = DateTime.UtcNow,
            PreviousAssigneeUserId = previous, NewAssigneeUserId = request.AssignedToUserId,
            CreatedByUserId = actorUserId
        });
        await context.SaveChangesAsync(cancellationToken);
        if (task.ReservationId.HasValue)
            await AppendActivityAsync(task, actorUserId, "AdminTaskReassigned", "وظیفه واگذار شد", cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(task, task.Changes.OrderBy(row => row.OccurredAtUtc).ThenBy(row => row.Id).ToArray());
    }

    public async Task<AdminTaskResponse> UpdateStatusAsync(
        int actorUserId, int id, UpdateAdminTaskStatusRequest request, CancellationToken cancellationToken = default)
    {
        await RequireGlobalPermissionAsync(actorUserId, cancellationToken);
        if (!Enum.IsDefined(request.Status)) throw new ArgumentOutOfRangeException(nameof(request.Status));
        var resolution = Optional(request.ResolutionNote, 4000, nameof(request.ResolutionNote));
        var actorName = await ActorNameAsync(actorUserId, cancellationToken);
        await using var transaction = context.Database.IsRelational()
            ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)
            : null;
        var task = await GetForWriteAsync(actorUserId, id, cancellationToken);
        if (task.Status == request.Status)
            throw new ArgumentException("The task already has this status.");
        var previous = task.Status;
        task.Status = request.Status;
        task.ResolutionNote = resolution;
        task.CompletedAtUtc = request.Status == AdminTaskStatus.Done ? DateTime.UtcNow : null;
        task.UpdatedByUserId = actorUserId;
        task.Changes.Add(new AdminTaskChange
        {
            ActorUserId = actorUserId, ActorDisplayName = actorName,
            ChangeType = AdminTaskChangeType.StatusChanged, OccurredAtUtc = DateTime.UtcNow,
            PreviousStatus = previous, NewStatus = request.Status,
            ResolutionNote = resolution, CreatedByUserId = actorUserId
        });
        await context.SaveChangesAsync(cancellationToken);
        if (task.ReservationId.HasValue)
            await AppendActivityAsync(task, actorUserId,
                request.Status == AdminTaskStatus.Done ? "AdminTaskCompleted" : "AdminTaskStatusChanged",
                request.Status == AdminTaskStatus.Done ? "وظیفه تکمیل شد" : "وضعیت وظیفه تغییر کرد", cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Map(task, task.Changes.OrderBy(row => row.OccurredAtUtc).ThenBy(row => row.Id).ToArray());
    }

    private async Task<AdminTask> GetForWriteAsync(int actorUserId, int id, CancellationToken cancellationToken)
    {
        var task = await context.AdminTasks.Include(row => row.Changes)
            .SingleOrDefaultAsync(row => row.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Admin task not found.");
        await RequireReservationPermissionAsync(actorUserId, task.ReservationId, "bookings.edit", cancellationToken);
        return task;
    }

    private async Task RequireGlobalPermissionAsync(int userId, CancellationToken cancellationToken)
    {
        if (!await permissions.HasPermissionAsync(userId, PermissionKey.ManageReservations,
                cancellationToken: cancellationToken))
            throw new UnauthorizedAccessException("You cannot manage Admin tasks.");
    }

    private async Task RequireReservationPermissionAsync(
        int userId, int? reservationId, string permission, CancellationToken cancellationToken)
    {
        if (!reservationId.HasValue) return;
        var propertyId = await context.Reservations.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.Id == reservationId.Value)
            .Select(row => (int?)row.PropertyId).SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");
        if (!await permissions.CanAsync(userId, propertyId, permission, cancellationToken))
            throw new UnauthorizedAccessException("You cannot access this property's reservation tasks.");
    }

    private async Task RequireAdminAssigneeAsync(int userId, CancellationToken cancellationToken)
    {
        if (userId <= 0 || !await ActiveAdminUsers().AnyAsync(user => user.Id == userId, cancellationToken))
            throw new ArgumentException("Assignee must be an active Admin user.");
    }

    private IQueryable<User> ActiveAdminUsers() => context.Users.AsNoTracking()
        .Where(user => user.IsActive &&
            (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant));

    private async Task<string> ActorNameAsync(int userId, CancellationToken cancellationToken)
    {
        var actor = await context.Users.AsNoTracking().Where(user => user.Id == userId && user.IsActive &&
                (user.Role == UserRole.SuperAdmin || user.Role == UserRole.AdminAssistant))
            .Select(user => new { user.FirstName, user.LastName, user.Username, user.Email })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new UnauthorizedAccessException("An active Admin actor is required.");
        var name = $"{actor.FirstName} {actor.LastName}".Trim();
        if (name.Length == 0) name = actor.Username?.Trim() ?? string.Empty;
        if (name.Length == 0) name = actor.Email?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 200)
            throw new InvalidOperationException("Admin actor has no valid display name.");
        return name;
    }

    private Task<ReservationActivity> AppendActivityAsync(
        AdminTask task, int actorUserId, string type, string title, CancellationToken cancellationToken) =>
        activities.AppendAsync(task.ReservationId!.Value, actorUserId, type,
            ReservationActivityVisibility.Internal, title, task.Title,
            nameof(AdminTask), task.Id, cancellationToken);

    private static AdminTaskResponse Map(AdminTask task, IReadOnlyList<AdminTaskChange> changes) =>
        new(task.Id, task.Title, task.Description, task.Priority, task.DueAtUtc,
            task.CreatedByUserId!.Value, task.AssignedToUserId, task.ReservationId, task.Status,
            task.ResolutionNote, task.CreatedAtUtc, task.UpdatedAtUtc, task.CompletedAtUtc,
            changes.Select(row => new AdminTaskChangeResponse(row.Id, row.ActorUserId,
                row.ActorDisplayName, row.ChangeType, row.OccurredAtUtc, row.PreviousStatus,
                row.NewStatus, row.PreviousAssigneeUserId, row.NewAssigneeUserId, row.ResolutionNote)).ToArray());

    private static string Required(string? value, int limit, string name) =>
        Optional(value, limit, name) ?? throw new ArgumentException("Value is required.", name);

    private static string? Optional(string? value, int limit, string name)
    {
        var result = value?.Trim();
        if (string.IsNullOrEmpty(result)) return null;
        if (result.Length > limit) throw new ArgumentException($"Value exceeds {limit} characters.", name);
        return result;
    }
}
