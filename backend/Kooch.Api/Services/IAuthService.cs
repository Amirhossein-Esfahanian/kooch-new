using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default);
    string GenerateJwtToken(User user, DateTime expiresAtUtc);
}
