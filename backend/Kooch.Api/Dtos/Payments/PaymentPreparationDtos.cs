using Kooch.Api.Entities;
using Kooch.Api.Serialization;
using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.Payments;

public class ReservationPaymentPreparationResponse
{
    public bool IsValid { get; set; }
    public string? InvalidReason { get; set; }
    public int? ReservationId { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public string PropertyName { get; set; } = string.Empty;
    public string RoomTypeName { get; set; } = string.Empty;
    public DateOnly? CheckInDate { get; set; }
    public DateOnly? CheckOutDate { get; set; }
    public int NightsCount { get; set; }
    public ReservationStatus? Status { get; set; }
    public decimal TotalPrice { get; set; }
    public decimal PaidAmount { get; set; }
    public decimal RemainingAmount { get; set; }
    public string Currency { get; set; } = "IRR";
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? PaymentExpiresAtUtc { get; set; }
    public int? RemainingPaymentSeconds { get; set; }
    public string PlaceholderMessage { get; set; } = string.Empty;
}

public class ReservationPaymentPlaceholderResponse
{
    public bool IsValid { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? PlaceholderReference { get; set; }
}

public class PaymentConfirmationRequest
{
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRR";
    public string? Provider { get; set; }
    public string TransactionReference { get; set; } = string.Empty;
}

public class PaymentConfirmationResponse
{
    public int ReservationId { get; set; }
    public ReservationStatus ReservationStatus { get; set; }
    public bool CapacityClaimed { get; set; }
}
