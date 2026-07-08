using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Reservations;

public class ReservationListItemResponse
{
    public int ReservationId { get; set; }
    public int Id { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public int PropertyId { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public int RoomTypeId { get; set; }
    public string RoomTypeName { get; set; } = string.Empty;
    public int? GuestId { get; set; }
    public string GuestFullName { get; set; } = string.Empty;
    public string? GuestMobile { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int NightsCount { get; set; }
    public int Adults { get; set; }
    public int Children { get; set; }
    public int Infants { get; set; }
    public int RoomCount { get; set; }
    public decimal TotalPrice { get; set; }
    public decimal FinalAmount { get; set; }
    public decimal RemainingAmount { get; set; }
    public string Currency { get; set; } = "IRR";
    public ReservationStatus Status { get; set; }
    public ReservationSource Source { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime? PaymentExpiresAtUtc { get; set; }

    public string GuestName
    {
        get => GuestFullName;
        set => GuestFullName = value;
    }
}

public class ReservationResponse : ReservationListItemResponse
{
    public int? RoomId { get; set; }
    public int? RatePlanId { get; set; }
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public decimal BaseAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal ExtraGuestAmount { get; set; }
    public decimal ServiceFeeAmount { get; set; }
    public decimal ChildAmount { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal PayableAmount { get; set; }
    public string? Notes { get; set; }
    public DateTime? HoldUntilUtc { get; set; }
    public DateTime? PaidAtUtc { get; set; }
    public DateTime? ConfirmedAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }
    public DateTime? ExpiredAtUtc { get; set; }
}

public class ReservationListQuery
{
    public int? PropertyId { get; set; }
    public ReservationStatus? Status { get; set; }
    public int? RoomTypeId { get; set; }
    public string? GuestSearch { get; set; }
    public DateOnly? CheckInFrom { get; set; }
    public DateOnly? CheckInTo { get; set; }
    public DateTime? CreatedFrom { get; set; }
    public DateTime? CreatedTo { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
    public string? Sort { get; set; }
}

public class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; set; } = [];
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages { get; set; }
}

public class ReservationCreateRequest : IValidatableObject
{
    [Range(1, int.MaxValue)]
    public int PropertyId { get; set; }

    [Range(1, int.MaxValue)]
    public int RoomTypeId { get; set; }

    [Range(1, int.MaxValue)]
    public int GuestId { get; set; }

    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }

    [Range(1, 100)]
    public int Adults { get; set; } = 1;

    [Range(0, 100)]
    public int Children { get; set; }

    [Range(0, 100)]
    public int Infants { get; set; }

    [Range(1, 100)]
    public int RoomCount { get; set; } = 1;

    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (CheckOutDate <= CheckInDate)
        {
            yield return new ValidationResult(
                "تاریخ خروج باید بعد از تاریخ ورود باشد.",
                new[] { nameof(CheckInDate), nameof(CheckOutDate) });
        }
    }
}

public class ReservationUpdateRequest : IValidatableObject
{
    [Range(1, int.MaxValue)]
    public int GuestId { get; set; }

    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }

    [Range(1, 100)]
    public int Adults { get; set; } = 1;

    [Range(0, 100)]
    public int Children { get; set; }

    [Range(0, 100)]
    public int Infants { get; set; }

    [Range(1, 100)]
    public int RoomCount { get; set; } = 1;

    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (CheckOutDate <= CheckInDate)
        {
            yield return new ValidationResult(
                "تاریخ خروج باید بعد از تاریخ ورود باشد.",
                new[] { nameof(CheckInDate), nameof(CheckOutDate) });
        }
    }
}

public class ReservationStatusUpdateRequest
{
    public ReservationStatus Status { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }
}

public class ReservationPricePreviewRequest : IValidatableObject
{
    [Range(1, int.MaxValue)]
    public int PropertyId { get; set; }

    [Range(1, int.MaxValue)]
    public int RoomTypeId { get; set; }

    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }

    [Range(1, 100)]
    public int Adults { get; set; } = 1;

    [Range(0, 100)]
    public int Children { get; set; }

    [Range(0, 100)]
    public int Infants { get; set; }

    [Range(1, 100)]
    public int RoomCount { get; set; } = 1;

    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (CheckOutDate <= CheckInDate)
        {
            yield return new ValidationResult(
                "تاریخ خروج باید بعد از تاریخ ورود باشد.",
                new[] { nameof(CheckInDate), nameof(CheckOutDate) });
        }
    }
}

public class ReservationPricePreviewResponse
{
    public int PropertyId { get; set; }
    public int RoomTypeId { get; set; }
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int NightsCount { get; set; }
    public int Adults { get; set; }
    public int Children { get; set; }
    public int Infants { get; set; }
    public int RoomCount { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal ExtraGuestAmount { get; set; }
    public decimal ChildAmount { get; set; }
    public decimal ServiceFeeAmount { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal FinalAmount { get; set; }
    public decimal BasePrice => BaseAmount;
    public decimal ChildCharge => ChildAmount;
    public decimal ExtraGuestCharge => ExtraGuestAmount;
    public decimal PromotionDiscount => DiscountAmount;
    public decimal TotalPrice => FinalAmount;
    public string Currency { get; set; } = "IRR";
    public IReadOnlyList<ReservationNightPriceSnapshot> Nights { get; set; } = [];
}

public class ReservationNightPriceSnapshot
{
    public DateOnly Date { get; set; }
    public decimal BasePrice { get; set; }
    public decimal ExtraGuestAmount { get; set; }
    public decimal ChildAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal FinalAmount { get; set; }
}
