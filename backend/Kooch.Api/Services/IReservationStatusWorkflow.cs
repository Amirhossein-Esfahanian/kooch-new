using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IReservationStatusWorkflow
{
    IReadOnlyCollection<ReservationStatus> GetAllowedManualCreationStatuses(bool isOnRequest);

    IReadOnlyCollection<ReservationStatus> GetAllowedTransitions(ReservationStatus from);

    bool CanTransition(ReservationStatus from, ReservationStatus to);

    void ValidateTransition(ReservationStatus from, ReservationStatus to);

    void ValidateManualCreationStatus(bool isOnRequest, ReservationStatus status);
}
