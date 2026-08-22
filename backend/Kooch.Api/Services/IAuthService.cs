using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IAuthService
{
    Task<RequestOtpResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<RequestOtpResponse> RequestOtpAsync(RequestOtpRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse?> VerifyOtpAsync(VerifyOtpRequest request, CancellationToken cancellationToken = default);
    Task SetPasswordAsync(SetPasswordRequest request, CancellationToken cancellationToken = default);
    Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(string token, CancellationToken cancellationToken = default);
    Task<string> CreatePasswordSetupTokenAsync(int userId, CancellationToken cancellationToken = default);
    Task<string> CreatePasswordSetupTokenWithoutNotificationAsync(int userId, CancellationToken cancellationToken = default) =>
        CreatePasswordSetupTokenAsync(userId, cancellationToken);
    Task SendPasswordSetupNotificationAsync(int userId, string setupLink, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
    Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default);
    Task<CurrentUserResponse?> UpdateCurrentUserProfileAsync(
        int userId,
        UpdateCurrentUserProfileRequest request,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
    string GenerateJwtToken(User user, DateTime expiresAtUtc);
}
