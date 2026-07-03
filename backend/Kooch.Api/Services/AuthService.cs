using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Kooch.Api.Services;

public class AuthService(
    KoochDbContext dbContext,
    IOptions<JwtOptions> jwtOptions) : IAuthService
{
    private readonly JwtOptions _jwtOptions = jwtOptions.Value;

    public async Task<AuthResponse> RegisterAsync(
        RegisterRequest request,
        CancellationToken cancellationToken = default)
    {
        var role = request.Role ?? UserRole.Client;
        if (role is not UserRole.Client and not UserRole.Owner)
        {
            throw new ArgumentException("Public registration is limited to Client or Owner roles.");
        }

        var email = NormalizeEmail(request.Email);
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw new InvalidOperationException("An account with this email already exists.");
        }

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = role,
            IsActive = true
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);

        return CreateAuthResponse(user);
    }

    public async Task<AuthResponse?> LoginAsync(
        LoginRequest request,
        CancellationToken cancellationToken = default)
    {
        var email = NormalizeEmail(request.Email);
        var user = await dbContext.Users
            .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);

        if (user is null ||
            !user.IsActive ||
            user.PasswordSetupRequired ||
            !IsValidPassword(request.Password, user.PasswordHash))
        {
            return null;
        }

        return CreateAuthResponse(user);
    }

    public async Task<string> CreatePasswordSetupTokenAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var userExists = await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.Id == userId, cancellationToken);
        if (!userExists)
        {
            throw new KeyNotFoundException("User not found.");
        }

        var rawToken = CreateRawToken();
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = userId,
            TokenHash = HashToken(rawToken),
            ExpiresAtUtc = DateTime.UtcNow.AddHours(24)
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        return $"/set-password?token={Uri.EscapeDataString(rawToken)}";
    }

    public async Task SetPasswordAsync(
        SetPasswordRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.NewPassword != request.ConfirmPassword)
        {
            throw new ArgumentException("Password confirmation does not match.");
        }

        ValidatePasswordStrength(request.NewPassword);
        var tokenHash = HashToken(request.Token);
        var now = DateTime.UtcNow;
        var setupToken = await dbContext.PasswordSetupTokens
            .Include(token => token.User)
            .SingleOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken)
            ?? throw new InvalidOperationException("Password setup token is invalid.");

        if (setupToken.UsedAtUtc.HasValue)
        {
            throw new InvalidOperationException("Password setup token has already been used.");
        }

        if (setupToken.ExpiresAtUtc <= now)
        {
            throw new InvalidOperationException("Password setup token has expired.");
        }

        setupToken.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        setupToken.User.PasswordSetupRequired = false;
        setupToken.User.InvitationAcceptedAtUtc = now;
        setupToken.User.IsActive = true;
        setupToken.UsedAtUtc = now;

        var propertyAccesses = await dbContext.UserPropertyAccesses
            .Where(access => access.UserId == setupToken.UserId &&
                             access.Status == PropertyUserStatus.Pending)
            .ToListAsync(cancellationToken);
        foreach (var access in propertyAccesses)
        {
            access.Status = PropertyUserStatus.Active;
            access.IsActive = true;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<CurrentUserResponse?> GetCurrentUserAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        return await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => new CurrentUserResponse
            {
                UserId = user.Id,
                FullName = (user.FirstName + " " + user.LastName).Trim(),
                Email = user.Email,
                Role = user.Role
            })
            .SingleOrDefaultAsync(cancellationToken);
    }

    public string GenerateJwtToken(User user, DateTime expiresAtUtc)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, $"{user.FirstName} {user.LastName}".Trim()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtOptions.Key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _jwtOptions.Issuer,
            audience: _jwtOptions.Audience,
            claims: claims,
            expires: expiresAtUtc,
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private AuthResponse CreateAuthResponse(User user)
    {
        var expiresAtUtc = DateTime.UtcNow.AddMinutes(_jwtOptions.ExpiresMinutes);
        return new AuthResponse
        {
            Token = GenerateJwtToken(user, expiresAtUtc),
            ExpiresAtUtc = expiresAtUtc,
            UserId = user.Id,
            FullName = $"{user.FirstName} {user.LastName}".Trim(),
            Email = user.Email,
            Role = user.Role
        };
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static bool IsValidPassword(string password, string passwordHash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, passwordHash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            return false;
        }
    }

    private static string CreateRawToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace("+", "-", StringComparison.Ordinal)
            .Replace("/", "_", StringComparison.Ordinal)
            .TrimEnd('=');
    }

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
        return Convert.ToHexString(bytes);
    }

    private static void ValidatePasswordStrength(string password)
    {
        if (password.Length < 8 ||
            !password.Any(char.IsUpper) ||
            !password.Any(char.IsLower) ||
            !password.Any(char.IsDigit))
        {
            throw new ArgumentException(
                "Password must be at least 8 characters and include uppercase, lowercase, and a number.");
        }
    }
}
