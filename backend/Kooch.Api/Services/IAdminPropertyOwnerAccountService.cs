using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminPropertyOwnerAccountService
{
    Task<IReadOnlyList<AdminPropertyOwnerAccountResponse>> GetCandidatesAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken = default);

    Task<AdminPropertyOwnerAccountResponse> CreateAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken = default);
}
