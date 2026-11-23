namespace Kooch.Api.Services;

public sealed class ManualPaymentReviewException(string message, string code) : InvalidOperationException(message)
{
    public const string DeadlineExpired = "ManualPaymentDeadlineExpired";
    public const string AlreadyReviewed = "ManualPaymentAlreadyReviewed";
    public string Code { get; } = code;
}
