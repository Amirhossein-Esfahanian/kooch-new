using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Kooch.Api.Entities;
using Kooch.Api.Serialization;

namespace Kooch.Api.Dtos.Payments;

public sealed class ManualPaymentReviewQueueQuery
{
    [Range(1, 1_000_000)] public int Page { get; set; } = 1;
    [Range(1, 100)] public int PageSize { get; set; } = 20;
    [Range(1, int.MaxValue)] public int? PropertyId { get; set; }
}

public sealed class ManualPaymentReviewQueueItem
{
    public int PaymentId { get; set; }
    public int ReservationId { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public string? OrderCode { get; set; }
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string GuestName { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string? CurrencyLabel { get; set; }
    public string Currency { get; set; } = string.Empty;
    public ManualPaymentMethod Method { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))] public DateTime CreatedAtUtc { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))] public DateTime? PaymentExpiresAtUtc { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))] public DateTime? ReviewProtectionExpiresAtUtc { get; set; }
    public ReservationStatus ReservationStatus { get; set; }
    public string ReviewState { get; set; } = string.Empty;
}
