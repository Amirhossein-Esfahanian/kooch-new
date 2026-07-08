using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationStatusWorkflow
{
    bool CanTransition(ReservationStatus from, ReservationStatus to);

    void ValidateTransition(ReservationStatus from, ReservationStatus to);
}
