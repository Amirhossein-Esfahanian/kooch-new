namespace Kooch.Api.Entities;

public class ReservationVoucher : BaseEntity
{
    public int ReservationId { get; set; }
    public int ReservationFinancialSnapshotId { get; set; }
    public int PropertyId { get; set; }
    public string VoucherNumber { get; set; } = string.Empty;
    public DateTime IssuedAtUtc { get; set; }

    public string ReservationNumberSnapshot { get; set; } = string.Empty;
    public string PropertyNameSnapshot { get; set; } = string.Empty;
    public string GuestNameSnapshot { get; set; } = string.Empty;
    public string? GuestMobileSnapshot { get; set; }
    public string? GuestEmailSnapshot { get; set; }
    public string RoomTypeNameSnapshot { get; set; } = string.Empty;
    public string? RoomNameSnapshot { get; set; }
    public DateOnly CheckInSnapshot { get; set; }
    public DateOnly CheckOutSnapshot { get; set; }
    public int NightsSnapshot { get; set; }
    public int AdultCountSnapshot { get; set; }
    public int ChildCountSnapshot { get; set; }

    public decimal GrossAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public decimal CommissionRate { get; set; }
    public decimal CommissionAmount { get; set; }
    public decimal PropertyPayableAmount { get; set; }

    public Reservation Reservation { get; set; } = null!;
    public ReservationFinancialSnapshot ReservationFinancialSnapshot { get; set; } = null!;
    public Property Property { get; set; } = null!;
}
