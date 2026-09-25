using Kooch.Api.Entities;
using Kooch.Api.Serialization;
using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.Payments;

public sealed class AdminManualPaymentCreateRequest
{
    public int ReservationId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public ManualPaymentMethod Method { get; set; }
    public DateOnly PaymentDate { get; set; }
    public TimeOnly? PaymentTime { get; set; }
    public string? ReferenceNumber { get; set; }
    public string? DestinationBank { get; set; }
    public string? DestinationAccountReference { get; set; }
    public string? Notes { get; set; }
    public string? EvidenceFilePath { get; set; }
}

public sealed class AdminManualPaymentRejectRequest
{
    public string Reason { get; set; } = string.Empty;
}

public sealed class AdminManualPaymentResponse
{
    public int PaymentId { get; set; }
    public int ReservationId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public PaymentChannel Channel { get; set; }
    public PaymentStatus Status { get; set; }
    public ManualPaymentMethod Method { get; set; }
    public ManualPaymentVerificationStatus VerificationStatus { get; set; }
    public DateOnly PaymentDate { get; set; }
    public TimeOnly? PaymentTime { get; set; }
    public string? ReferenceNumber { get; set; }
    public string? DestinationBank { get; set; }
    public string? DestinationAccountReference { get; set; }
    public string? Notes { get; set; }
    public string? EvidenceFilePath { get; set; }
    public int? SubmittedByUserId { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime SubmittedAtUtc { get; set; }
    public int? VerifiedByUserId { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? VerifiedAtUtc { get; set; }
    public int? RejectedByUserId { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? RejectedAtUtc { get; set; }
    public string? RejectionReason { get; set; }
    public ReservationStatus ReservationStatus { get; set; }
    public bool CapacityClaimed { get; set; }
}

public sealed class AdminManualPaymentDetailsResponse
{
    public int PaymentId { get; set; }
    public int ReservationId { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public PaymentStatus Status { get; set; }
    public ManualPaymentMethod Method { get; set; }
    public ManualPaymentVerificationStatus VerificationStatus { get; set; }
    public DateOnly PaymentDate { get; set; }
    public TimeOnly? PaymentTime { get; set; }
    public string? ReferenceNumber { get; set; }
    public string? DestinationBank { get; set; }
    public string? DestinationAccountReference { get; set; }
    public string? Notes { get; set; }
    public int? SubmittedByUserId { get; set; }
    public string? SubmittedBy { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime SubmittedAtUtc { get; set; }
    public int? VerifiedByUserId { get; set; }
    public string? VerifiedBy { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? VerifiedAtUtc { get; set; }
    public int? RejectedByUserId { get; set; }
    public string? RejectedBy { get; set; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? RejectedAtUtc { get; set; }
    public string? RejectionReason { get; set; }
}
