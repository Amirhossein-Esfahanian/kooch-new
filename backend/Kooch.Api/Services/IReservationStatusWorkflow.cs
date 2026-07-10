using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationStatusWorkflow
{
    IReadOnlyCollection<ReservationStatus> GetAllowedTransitions(ReservationStatus from);

    bool CanTransition(ReservationStatus from, ReservationStatus to);

    void ValidateTransition(ReservationStatus from, ReservationStatus to);
}
