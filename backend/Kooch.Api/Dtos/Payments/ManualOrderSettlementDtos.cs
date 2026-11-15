namespace Kooch.Api.Dtos.Payments;

public sealed class ManualOrderSettlementRequest
{
    public string IdempotencyKey { get; set; } = string.Empty;
    public decimal ConfirmedAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public Entities.ManualPaymentMethod Method { get; set; }
    public DateOnly PaymentDate { get; set; }
    public TimeOnly? PaymentTime { get; set; }
    public string? ReferenceNumber { get; set; }
    public string? DestinationBank { get; set; }
    public string? DestinationAccountReference { get; set; }
    public string? Notes { get; set; }
}

public sealed class ManualOrderBalanceResponse
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public decimal RemainingAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool CanSettle { get; set; }
    public string? UnavailableReason { get; set; }
}

public sealed class ManualOrderSettlementResponse
{
    public int PaymentId { get; set; }
    public int BookingSessionId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public bool IsReplay { get; set; }
    public IReadOnlyList<ManualOrderAllocationResponse> Allocations { get; set; } = [];
}

public sealed record ManualOrderAllocationResponse(int ReservationId, decimal Amount);
