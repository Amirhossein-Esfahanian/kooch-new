using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Kooch.Api.Entities;
using Kooch.Api.Serialization;

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

public sealed class MarkSettlementPaidRequest
{
    [Required] public SettlementPaymentMethod? PaymentMethod { get; set; }
    [Required, StringLength(200, MinimumLength = 1)] public string? ReferenceNumber { get; set; }
    [Required] public DateTimeOffset? PaidAtUtc { get; set; }
    [StringLength(2000)] public string? Note { get; set; }
}

public sealed record SettlementPaymentRecordResponse(SettlementPaymentMethod PaymentMethod,
    string ReferenceNumber,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime PaidAtUtc,
    string? Note,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime RecordedAtUtc,
    string? PropertyNameSnapshot);

public sealed record SettlementResponse(int Id, string SettlementNumber, int PropertyId, decimal TotalAmount, string Currency,
    DateTime CreatedAtUtc, DateTime? PaidAtUtc, bool IsEarlySettlement, SettlementStatus Status,
    IReadOnlyList<SettlementItemResponse> Items, string PropertyName = "",
    DateTime? CancelledAtUtc = null, int? CancelledByUserId = null, string? CancellationReason = null,
    SettlementPaymentRecordResponse? PaymentRecord = null);
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
    DateTime? PaidAtUtc, bool IsEarlySettlement, bool CanViewReceipt);
public sealed record SettlementPropertyOption(int Id, string Name);

public sealed record SettlementReceiptItemResponse(string ReservationNumber, DateOnly PayableDueDate, decimal Amount);
public sealed record PropertySettlementReceiptResponse(string SettlementNumber, string PropertyName, decimal TotalAmount,
    string Currency, [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime PaidAtUtc,
    SettlementPaymentMethod PaymentMethod, string ReferenceNumber,
    int ItemCount, IReadOnlyList<SettlementReceiptItemResponse> Items);
public sealed record AdminSettlementReceiptResponse(string SettlementNumber, string PropertyName, decimal TotalAmount,
    string Currency, [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime PaidAtUtc,
    SettlementPaymentMethod PaymentMethod, string ReferenceNumber,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime RecordedAtUtc,
    string? Note, int ItemCount, IReadOnlyList<SettlementReceiptItemResponse> Items);
