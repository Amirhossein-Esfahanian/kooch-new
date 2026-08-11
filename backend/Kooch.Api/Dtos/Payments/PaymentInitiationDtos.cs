using Kooch.Api.Entities;
using Kooch.Api.Serialization;
using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.Payments;

public sealed class BookingSessionPaymentInitiationRequest
{
    public int BookingSessionId { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
}

public sealed class BookingSessionPaymentInitiationResult
{
    public int PaymentId { get; set; }
    public int BookingSessionId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public PaymentStatus Status { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string? TransactionReference { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime PaymentDeadlineUtc { get; set; }
    public string RequestHash { get; set; } = string.Empty;
    public bool IsReplay { get; set; }
    public IReadOnlyList<BookingSessionPaymentItemResult> Items { get; set; } = [];
}

public sealed class BookingSessionPaymentItemResult
{
    public int PaymentItemId { get; set; }
    public int ReservationId { get; set; }
    public decimal AllocatedAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}
