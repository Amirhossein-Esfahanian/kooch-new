using Kooch.Api.Entities;

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
