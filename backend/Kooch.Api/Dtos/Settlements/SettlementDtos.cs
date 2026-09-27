using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Settlements;

public sealed class CreateSettlementRequest
{
    [Range(1, int.MaxValue)] public int PropertyId { get; set; }
    [MinLength(1)] public int[] PayableEntryIds { get; set; } = [];
    public bool AllowEarlySettlement { get; set; }
}

public sealed record SettlementResponse(int Id, int PropertyId, decimal TotalAmount, string Currency,
    DateTime CreatedAtUtc, DateTime? PaidAtUtc, bool IsEarlySettlement, SettlementStatus Status,
    IReadOnlyList<SettlementItemResponse> Items);
public sealed record SettlementItemResponse(int FinancialEntryId, decimal Amount, DateOnly PayableDueDate);
