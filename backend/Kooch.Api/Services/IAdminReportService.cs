using Kooch.Api.Dtos.Reports;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminReportService
{
    Task<AdminReservationReportResponse> GetReservationsAsync(
        int userId, UserRole role, AdminReservationReportQuery query,
        CancellationToken cancellationToken = default);
}
