using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.AuditLogs;

public sealed class AdminAuditLogQuery : IValidatableObject
{
    [Range(1, int.MaxValue)] public int? ActorUserId { get; set; }
    [Range(1, int.MaxValue)] public int? PropertyId { get; set; }
    [EnumDataType(typeof(AuditAction))] public AuditAction? Action { get; set; }
    public DateTimeOffset? FromUtc { get; set; }
    public DateTimeOffset? ToUtc { get; set; }
    [Range(1, int.MaxValue)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 25;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (FromUtc.HasValue && ToUtc.HasValue && FromUtc >= ToUtc)
            yield return new ValidationResult("The end must be after the start.", [nameof(ToUtc)]);
        if ((long)(Page - 1) * PageSize > int.MaxValue)
            yield return new ValidationResult("Page is too large.", [nameof(Page)]);
    }
}

public sealed class AdminAuditLogResponse
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string ActorDisplayName { get; set; } = string.Empty;
    public DateTime OccurredAtUtc { get; set; }
    public AuditAction Action { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public int? EntityId { get; set; }
    public string? EntityName { get; set; }
    public bool HasPriceDetails { get; set; }
    public int? PropertyId { get; set; }
    public string? PropertyName { get; set; }
    public string? Description { get; set; }
    public IReadOnlyDictionary<string, JsonElement>? PreviousValues { get; set; }
    public IReadOnlyDictionary<string, JsonElement>? NewValues { get; set; }
}

public sealed class AdminPriceChangeQuery
{
    [Range(1, int.MaxValue)] public int PropertyId { get; set; }
    [Range(1, 50)] public int PageSize { get; set; } = 10;
    public DateOnly? After { get; set; }
}

public sealed record AdminDailyPriceChange(DateOnly Date, decimal PreviousPrice, decimal NewPrice,
    PricingGuestType GuestType);

public sealed record AdminPriceChangePage(IReadOnlyList<AdminDailyPriceChange> Items, bool HasMore, DateOnly? NextAfter);
