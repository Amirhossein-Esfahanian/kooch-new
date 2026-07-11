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
