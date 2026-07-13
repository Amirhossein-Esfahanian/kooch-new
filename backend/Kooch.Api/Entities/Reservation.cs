namespace Kooch.Api.Entities;

public class Reservation : BaseEntity
{
    public string? ReservationNumber { get; set; }
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public int? RatePlanId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int AdultCount { get; set; }
    public int ChildCount { get; set; }
    public decimal TotalPrice { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal ExtraGuestAmount { get; set; }
    public decimal ServiceFeeAmount { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = "IRR";
    public ReservationStatus Status { get; set; }
    public ReservationSource Source { get; set; }
    public string? GuestNote { get; set; }
    public DateTime? HoldUntilUtc { get; set; }
    public DateTime? ApprovedAtUtc { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime? PaymentExpiresAtUtc { get; set; }
    public DateTime? PaidAtUtc { get; set; }
    public DateTime? ConfirmedAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }
    public int? CancelledByUserId { get; set; }
    public ReservationCancellationReason? CancellationReason { get; set; }
    public string? CancellationNote { get; set; }
    public DateTime? ExpiredAtUtc { get; set; }
    public int? ChangedByUserId { get; set; }
    public DateTime? ChangedAtUtc { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public User Client { get; set; } = null!;
    public User? ApprovedByUser { get; set; }
    public User? CancelledByUser { get; set; }
    public Guest? Guest { get; set; }
    public Property Property { get; set; } = null!;
    public RoomType RoomType { get; set; } = null!;
    public Room? Room { get; set; }
    public RatePlan? RatePlan { get; set; }
    public ICollection<Payment> Payments { get; set; } = [];
    public ICollection<ReservationPaymentLinkToken> PaymentLinkTokens { get; set; } = [];
    public ICollection<Review> Reviews { get; set; } = [];
    public ICollection<NotificationLog> NotificationLogs { get; set; } = [];
}
