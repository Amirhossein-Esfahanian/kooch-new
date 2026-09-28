using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Settlements;

public sealed class CreateSettlementRequest
{
    [Range(1, int.MaxValue)] public int PropertyId { get; set; }
    [MinLength(1)] public int[] PayableEntryIds { get; set; } = [];
    public bool AllowEarlySettlement { get; set; }
}

public sealed class CancelSettlementRequest
{
    [Required, MaxLength(2000)] public string Reason { get; set; } = string.Empty;
}

public sealed record SettlementResponse(int Id, string SettlementNumber, int PropertyId, decimal TotalAmount, string Currency,
    DateTime CreatedAtUtc, DateTime? PaidAtUtc, bool IsEarlySettlement, SettlementStatus Status,
    IReadOnlyList<SettlementItemResponse> Items, string PropertyName = "",
    DateTime? CancelledAtUtc = null, int? CancelledByUserId = null, string? CancellationReason = null);
public sealed record SettlementItemResponse(int FinancialEntryId, decimal Amount, DateOnly PayableDueDate,
    string? ReservationNumber = null);

public sealed class SettlementListQuery
{
    public int? PropertyId { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public string? Search { get; set; }
    public string? Status { get; set; }
    public string? SortBy { get; set; }
    public string? SortDirection { get; set; }
}

public enum PayableStatus { Future = 0, Due = 1, Overdue = 2 }
public sealed record PropertyPayableResponse(int Id, int PropertyId, string PropertyName,
    string? ReservationNumber, decimal Amount, string Currency, DateOnly PayableDueDate, PayableStatus Status);
public sealed record SettlementListItemResponse(int Id, string SettlementNumber, int PropertyId, string PropertyName,
    decimal TotalAmount, string Currency, int ItemCount, SettlementStatus Status, DateTime CreatedAtUtc,
    DateTime? PaidAtUtc, bool IsEarlySettlement);
public sealed record SettlementPropertyOption(int Id, string Name);
