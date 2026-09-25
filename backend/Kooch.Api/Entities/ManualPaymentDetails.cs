namespace Kooch.Api.Entities;

public class ManualPaymentDetails : BaseEntity
{
    public int PaymentId { get; set; }
    public ManualPaymentMethod Method { get; set; }
    public ManualPaymentVerificationStatus VerificationStatus { get; set; } =
        ManualPaymentVerificationStatus.PendingVerification;
    public DateOnly PaymentDate { get; set; }
    public TimeOnly? PaymentTime { get; set; }
    public string? ReferenceNumber { get; set; }
    public string? DestinationBank { get; set; }
    public string? DestinationAccountReference { get; set; }
    public string? Notes { get; set; }
    public string? EvidenceFilePath { get; set; }
    public int? SubmittedByUserId { get; set; }
    public DateTime SubmittedAtUtc { get; set; }
    public int? VerifiedByUserId { get; set; }
    public DateTime? VerifiedAtUtc { get; set; }
    public int? RejectedByUserId { get; set; }
    public DateTime? RejectedAtUtc { get; set; }
    public string? RejectionReason { get; set; }

    public Payment Payment { get; set; } = null!;
    public User? SubmittedByUser { get; set; }
    public User? VerifiedByUser { get; set; }
    public User? RejectedByUser { get; set; }
}
