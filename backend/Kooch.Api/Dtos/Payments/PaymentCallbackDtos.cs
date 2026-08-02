namespace Kooch.Api.Dtos.Payments;

public sealed class PaymentCallbackResponse
{
    public bool Accepted { get; set; }
    public bool IsDuplicate { get; set; }
    public string State { get; set; } = string.Empty;
}

public sealed class PaymentCallbackErrorResponse
{
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
