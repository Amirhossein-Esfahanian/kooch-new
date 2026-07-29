using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminPropertyOwnerAccountService
{
    Task<AdminPropertyOwnerCandidatePageResponse> SearchCandidatesAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerCandidateQuery query,
        CancellationToken cancellationToken = default);

    Task<AdminPropertyOwnerAccountResponse> CreateAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken = default);
}
