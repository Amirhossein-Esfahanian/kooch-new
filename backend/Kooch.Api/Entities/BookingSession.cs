namespace Kooch.Api.Entities;

public class BookingSession : BaseEntity
{
    public string SessionCode { get; set; } = string.Empty;
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    // 1 = self, 2 = other; null identifies historical rows without a captured snapshot.
    public byte? TravelerSnapshotKind { get; set; }
    public string? TravelerFirstNameSnapshot { get; set; }
    public string? TravelerLastNameSnapshot { get; set; }
    public string? TravelerMobileSnapshot { get; set; }
    public string? TravelerEmailSnapshot { get; set; }
    public string? TravelerNationalCodeSnapshot { get; set; }
    public DateTime? TravelerSnapshotCapturedAtUtc { get; set; }
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public CommissionType? CommissionType { get; set; }
    public TimeOnly? ExpectedArrivalTime { get; set; }
    public byte? ExpectedArrivalDayOffset { get; set; }
    public bool ReceptionCoordinationRequired { get; set; }
    public DateTime? ReceptionCoordinationAcknowledgedAtUtc { get; set; }
    public string? IdempotencyKey { get; set; }
    public string? RequestHash { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public User Client { get; set; } = null!;
    public Guest? Guest { get; set; }
    public Property Property { get; set; } = null!;
    public ICollection<Reservation> Reservations { get; set; } = [];
    public ICollection<Payment> Payments { get; set; } = [];
}
