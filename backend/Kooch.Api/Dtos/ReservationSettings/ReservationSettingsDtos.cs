using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.ReservationSettings;

public sealed record ReservationSettingsResponse(
    int? FreeChildMaxAge,
    int? HalfPriceChildMinAge,
    int? HalfPriceChildMaxAge,
    decimal HalfPriceChildRate);

public sealed record UpdateReservationSettingsRequest(
    int? FreeChildMaxAge,
    int? HalfPriceChildMinAge,
    int? HalfPriceChildMaxAge,
    decimal HalfPriceChildRate);

public sealed record ReservationDeadlineSettingsResponse(
    int PaymentWindowMinutes,
    int OwnerApprovalWindowMinutes,
    int OwnerApprovalReminderIntervalMinutes);

public sealed record UpdateReservationDeadlineSettingsRequest(
    [property: Required, Range(1, 10080)] int PaymentWindowMinutes,
    [property: Required, Range(1, 10080)] int OwnerApprovalWindowMinutes,
    [property: Required, Range(1, 10080)] int OwnerApprovalReminderIntervalMinutes);
