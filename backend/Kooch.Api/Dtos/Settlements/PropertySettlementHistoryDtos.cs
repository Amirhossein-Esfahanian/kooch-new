using System.Text.Json.Serialization;
using Kooch.Api.Entities;
using Kooch.Api.Serialization;

namespace Kooch.Api.Dtos.Settlements;

public sealed class PropertySettlementHistoryQuery
{
    public string? Search { get; set; }
    public string? Status { get; set; }
    public string? SortBy { get; set; }
    public string? SortDirection { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public sealed record PropertySettlementHistoryItemResponse(string SettlementNumber, SettlementStatus Status,
    decimal TotalAmount, string Currency, int ItemCount,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime CreatedAtUtc,
    DateOnly? OldestPayableDueDate,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime? PaidAtUtc,
    bool CanViewReceipt);

public sealed record PropertySettlementHistoryPaymentResponse(SettlementPaymentMethod PaymentMethod,
    string ReferenceNumber, [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime PaidAtUtc);

public sealed record PropertySettlementHistoryDetailItemResponse(string? ReservationNumber,
    DateOnly? PayableDueDate, decimal Amount);

public sealed record PropertySettlementHistoryDetailResponse(string SettlementNumber, SettlementStatus Status,
    decimal TotalAmount, string Currency,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime CreatedAtUtc,
    DateOnly? OldestPayableDueDate,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime? PaidAtUtc,
    PropertySettlementHistoryPaymentResponse? Payment, int ItemCount, bool CanViewReceipt,
    IReadOnlyList<PropertySettlementHistoryDetailItemResponse> Items);
