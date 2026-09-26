namespace Kooch.Api.Dtos.Reservations;

public sealed class GuestReservationVoucherResponse
{
    public string VoucherNumber { get; set; } = string.Empty;
    public string ReservationNumber { get; set; } = string.Empty;
    public DateTime IssuedAtUtc { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string GuestName { get; set; } = string.Empty;
    public string RoomTypeName { get; set; } = string.Empty;
    public string? RoomName { get; set; }
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public int Nights { get; set; }
    public int AdultCount { get; set; }
    public int ChildCount { get; set; }
    public decimal GrossAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}

public sealed class OwnerReservationVoucherResponse
{
    public string VoucherNumber { get; set; } = string.Empty;
    public string ReservationNumber { get; set; } = string.Empty;
    public DateTime IssuedAtUtc { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string GuestName { get; set; } = string.Empty;
    public string RoomTypeName { get; set; } = string.Empty;
    public string? RoomName { get; set; }
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public int Nights { get; set; }
    public int AdultCount { get; set; }
    public int ChildCount { get; set; }
    public decimal GrossAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
    public decimal CommissionRate { get; set; }
    public decimal CommissionAmount { get; set; }
    public decimal PropertyPayableAmount { get; set; }
}
