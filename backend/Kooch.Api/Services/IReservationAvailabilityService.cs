using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationAvailabilityService
{
    Task<ReservationAvailabilityResult> GetAvailabilityAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        CancellationToken cancellationToken = default);

    Task ValidateAsync(
        int propertyId,
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        int roomCount,
        CancellationToken cancellationToken = default);
}

public class ReservationAvailabilityResult
{
    public IReadOnlyList<ReservationNightAvailability> Nights { get; set; } = [];
    public bool HasOnRequestNight => Nights.Any(night => night.Status == AvailabilityStatus.OnRequest);
    public bool AllAvailable => Nights.Count > 0 && Nights.All(night => night.Status == AvailabilityStatus.Available);
}

public class ReservationNightAvailability
{
    public DateOnly Date { get; set; }
    public AvailabilityStatus Status { get; set; }
    public int AvailableCount { get; set; }
    public bool IsClosed { get; set; }
}
