using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAdminUserService
{
    Task<IReadOnlyList<AdminUserResponse>> GetUsersAsync(int currentUserId, UserRole currentRole, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> GetUserAsync(int currentUserId, UserRole currentRole, int userId, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> CreateUserAsync(int currentUserId, UserRole currentRole, AdminUserRequest request, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> UpdateUserAsync(int currentUserId, UserRole currentRole, int userId, AdminUserRequest request, CancellationToken cancellationToken = default);
    Task<AdminUserResponse> SetActiveAsync(int currentUserId, UserRole currentRole, int userId, bool isActive, CancellationToken cancellationToken = default);
}
