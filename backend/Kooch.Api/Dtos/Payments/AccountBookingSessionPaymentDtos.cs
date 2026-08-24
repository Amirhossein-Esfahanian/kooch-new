using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Payments;

public sealed class AccountBookingSessionPaymentRequest
{
    public string ProviderKey { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
}

public sealed class AccountPaymentProviderOptionResponse
{
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

public sealed class AccountBookingSessionPaymentInitiationResponse
{
    public int PaymentId { get; set; }
    public PaymentStatus Status { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public string CheckoutDestination { get; set; } = string.Empty;
    public bool IsReplay { get; set; }
}

public sealed class MockPaymentSimulationRequest
{
    public bool Succeeded { get; set; }
}

public sealed class MockPaymentSimulationResponse
{
    public int PaymentId { get; set; }
    public string State { get; set; } = string.Empty;
    public bool IsDuplicate { get; set; }
    public string RedirectDestination { get; set; } = string.Empty;
}
