using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminPropertyMemberDirectoryService
{
    Task<AdminPropertyMemberIdentityResponse> UpdateIdentityAsync(
        int currentUserId,
        UserRole currentRole,
        int userId,
        AdminPropertyMemberIdentityUpdateRequest request,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AdminPropertyMemberPropertyOptionResponse>> SearchPropertiesAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyMemberPropertyOptionQuery query,
        CancellationToken cancellationToken = default);

    Task<PagedResult<AdminPropertyMemberDirectoryResponse>> SearchAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyMemberDirectoryQuery query,
        CancellationToken cancellationToken = default);
}
