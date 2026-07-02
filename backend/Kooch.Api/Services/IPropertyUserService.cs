using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyUserService
{
    Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(int currentUserId, UserRole currentRole, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyUserResponse> CreateUserAsync(int currentUserId, UserRole currentRole, int propertyId, PropertyUserRequest request, CancellationToken cancellationToken = default);
    Task<PropertyUserResponse> UpdateUserAsync(int currentUserId, UserRole currentRole, int propertyId, int userId, PropertyUserRequest request, CancellationToken cancellationToken = default);
    Task DeleteUserAsync(int currentUserId, UserRole currentRole, int propertyId, int userId, CancellationToken cancellationToken = default);
}
