using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Utilities;

namespace Kooch.Api.Dtos.BookingSessions;

public sealed class BookingSessionCreateRequest
{
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public string? IdempotencyKey { get; set; }
    public IReadOnlyList<BookingSessionReservationCreateItem> Items { get; set; } = [];
}

public sealed class AccountBookingSessionCreateRequest : IValidatableObject
{
    public string? IdempotencyKey { get; set; }
    public bool BookingForSelf { get; set; } = true;
    public AccountBookingSessionPrimaryGuestRequest? PrimaryGuest { get; set; }
    public TimeOnly? ExpectedArrivalTime { get; set; }

    [MaxLength(2000)]
    public string? SpecialRequest { get; set; }

    public IReadOnlyList<AccountBookingSessionReservationCreateItem> Items { get; set; } = [];

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (BookingForSelf)
        {
            if (PrimaryGuest is not null)
            {
                foreach (var result in GuestCreateRequest.ValidateContactFields(
                             PrimaryGuest.Email,
                             PrimaryGuest.Mobile))
                {
                    yield return result;
                }
            }

            yield break;
        }

        if (PrimaryGuest is null)
        {
            yield return new ValidationResult(
                "اطلاعات مهمان اصلی الزامی است.",
                [nameof(PrimaryGuest)]);
            yield break;
        }

        if (GuestNormalization.NormalizeText(PrimaryGuest.FirstName) is null)
        {
            yield return new ValidationResult(
                "نام مهمان اصلی الزامی است.",
                [nameof(PrimaryGuest.FirstName)]);
        }

        if (GuestNormalization.NormalizeText(PrimaryGuest.LastName) is null)
        {
            yield return new ValidationResult(
                "نام خانوادگی مهمان اصلی الزامی است.",
                [nameof(PrimaryGuest.LastName)]);
        }

        if (GuestNormalization.NormalizeMobile(PrimaryGuest.Mobile) is null &&
            GuestNormalization.NormalizeEmail(PrimaryGuest.Email) is null)
        {
            yield return new ValidationResult(
                "شماره موبایل یا ایمیل مهمان اصلی الزامی است.",
                [nameof(PrimaryGuest.Mobile), nameof(PrimaryGuest.Email)]);
        }

        foreach (var result in GuestCreateRequest.ValidateContactFields(
                     PrimaryGuest.Email,
                     PrimaryGuest.Mobile))
        {
            yield return result;
        }
    }
}

public sealed class AccountBookingSessionPrimaryGuestRequest
{
    [MaxLength(100)]
    public string? FirstName { get; set; }

    [MaxLength(100)]
    public string? LastName { get; set; }

    [MaxLength(30)]
    public string? Mobile { get; set; }

    [MaxLength(320)]
    public string? Email { get; set; }

    [MaxLength(20)]
    public string? NationalCode { get; set; }
}

public sealed class AccountBookingSessionReservationCreateItem
{
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; } = 1;
    public int Children { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public string? Notes { get; set; }
}

public sealed class BookingSessionReservationCreateItem
{
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int Adults { get; set; } = 1;
    public int Children { get; set; }
    public IReadOnlyList<int> ChildAges { get; set; } = [];
    public PricingGuestType GuestType { get; set; } = PricingGuestType.Iranian;
    public ReservationStatus? Status { get; set; }
    public string? Notes { get; set; }
}

public sealed class BookingSessionCreateResult
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public int ClientId { get; set; }
    public int? GuestId { get; set; }
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public IReadOnlyList<BookingSessionReservationResult> Reservations { get; set; } = [];
}

public sealed class AccountBookingSessionCreateResponse
{
    public int BookingSessionId { get; set; }
    public string SessionCode { get; set; } = string.Empty;
    public int PropertyId { get; set; }
    public string Currency { get; set; } = string.Empty;
    public IReadOnlyList<BookingSessionReservationResult> Reservations { get; set; } = [];
}

public sealed class BookingSessionReservationResult
{
    public int ReservationId { get; set; }
    public string ReservationNumber { get; set; } = string.Empty;
    public int RoomTypeId { get; set; }
    public int? RoomId { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public ReservationStatus Status { get; set; }
    public decimal FinalAmount { get; set; }
    public string Currency { get; set; } = string.Empty;
}
