using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.Payments;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ReservationRefundRequest
{
    [Required, MaxLength(200)] public string ReferenceNumber { get; set; } = string.Empty;
    [Required] public DateTimeOffset? RefundedAt { get; set; }
    [Required, MaxLength(1000)] public string Reason { get; set; } = string.Empty;
    [MaxLength(2000)] public string? Note { get; set; }
    [Required, MaxLength(200)] public string IdempotencyKey { get; set; } = string.Empty;
}

public sealed record ReservationRefundResponse(int Id, int ReservationId, int PaymentId, int? PaymentItemId,
    decimal Amount, string Currency, DateTime RefundedAtUtc, string ReferenceNumber, string Reason,
    string? Note, DateTime RecordedAtUtc);
