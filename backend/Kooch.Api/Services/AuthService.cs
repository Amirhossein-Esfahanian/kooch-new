using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Kooch.Api.Services;

public class AuthService(
    KoochDbContext dbContext,
    IOptions<JwtOptions> jwtOptions,
    IHostEnvironment appEnvironment) : IAuthService
{
    private readonly JwtOptions _jwtOptions = jwtOptions.Value;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan OtpRequestCooldown = TimeSpan.FromSeconds(60);

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
            throw new ArgumentException("این ایمیل قبلاً ثبت شده است.");
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
        var identifier = string.IsNullOrWhiteSpace(request.Identifier)
            ? request.Email ?? string.Empty
            : request.Identifier;
        var user = await FindUserByIdentifierAsync(identifier, cancellationToken);

        if (user is null ||
            !user.IsActive ||
            user.PasswordSetupRequired ||
            !IsValidPassword(request.Password, user.PasswordHash))
        {
            return null;
        }

        return CreateAuthResponse(user);
    }

    public async Task<RequestOtpResponse> RequestOtpAsync(
        RequestOtpRequest request,
        CancellationToken cancellationToken = default)
    {
        var mobile = NormalizeMobile(request.Mobile)
            ?? throw new ArgumentException("Mobile number is required.");
        var user = await FindUserByMobileAsync(mobile, cancellationToken)
            ?? throw new InvalidOperationException("No active account was found for this mobile number.");

        if (!user.IsActive || user.PasswordSetupRequired)
        {
            throw new InvalidOperationException("This account cannot use OTP login yet.");
        }

        var now = DateTime.UtcNow;
        var recentRequestExists = await dbContext.MobileOtpCodes
            .AnyAsync(code => code.Mobile == mobile &&
                              code.CreatedAtUtc >= now.Subtract(OtpRequestCooldown) &&
                              code.UsedAtUtc == null,
                cancellationToken);
        if (recentRequestExists)
        {
            throw new InvalidOperationException("Please wait before requesting another OTP code.");
        }

        var rawCode = CreateOtpCode();
        var expiresAtUtc = now.Add(OtpLifetime);
        dbContext.MobileOtpCodes.Add(new MobileOtpCode
        {
            UserId = user.Id,
            Mobile = mobile,
            CodeHash = HashToken($"{mobile}:{rawCode}"),
            ExpiresAtUtc = expiresAtUtc
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        return new RequestOtpResponse
        {
            Sent = true,
            ExpiresAtUtc = expiresAtUtc,
            DevOtpCode = appEnvironment.IsDevelopment() ? rawCode : null
        };
    }

    public async Task<AuthResponse?> VerifyOtpAsync(
        VerifyOtpRequest request,
        CancellationToken cancellationToken = default)
    {
        var mobile = NormalizeMobile(request.Mobile);
        if (string.IsNullOrWhiteSpace(mobile))
        {
            return null;
        }

        var code = NormalizeOtpCode(request.Code);
        if (code.Length is < 4 or > 8)
        {
            return null;
        }

        var codeHash = HashToken($"{mobile}:{code}");
        var now = DateTime.UtcNow;
        var otp = await dbContext.MobileOtpCodes
            .Include(item => item.User)
            .Where(item => item.Mobile == mobile && item.CodeHash == codeHash)
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        if (otp is null ||
            otp.UsedAtUtc.HasValue ||
            otp.ExpiresAtUtc <= now ||
            !otp.User.IsActive ||
            otp.User.PasswordSetupRequired)
        {
            return null;
        }

        otp.UsedAtUtc = now;
        await dbContext.SaveChangesAsync(cancellationToken);
        return CreateAuthResponse(otp.User);
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

    private async Task<User?> FindUserByIdentifierAsync(
        string identifier,
        CancellationToken cancellationToken)
    {
        if (identifier.Contains('@', StringComparison.Ordinal))
        {
            var email = NormalizeEmail(identifier);
            return await dbContext.Users
                .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
        }

        var mobile = NormalizeMobile(identifier);
        return string.IsNullOrWhiteSpace(mobile)
            ? null
            : await FindUserByMobileAsync(mobile, cancellationToken);
    }

    private async Task<User?> FindUserByMobileAsync(
        string mobile,
        CancellationToken cancellationToken)
    {
        var variants = BuildMobileVariants(mobile);
        return await dbContext.Users
            .SingleOrDefaultAsync(user => user.PhoneNumber != null && variants.Contains(user.PhoneNumber), cancellationToken);
    }

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

    private static string CreateOtpCode()
    {
        return RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
    }

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
        return Convert.ToHexString(bytes);
    }

    private static string NormalizeOtpCode(string code)
    {
        var builder = new StringBuilder();
        foreach (var character in code.Trim())
        {
            var normalized = NormalizeDigit(character);
            if (char.IsDigit(normalized))
            {
                builder.Append(normalized);
            }
        }

        return builder.ToString();
    }

    private static string? NormalizeMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;

        var builder = new StringBuilder();
        foreach (var character in mobile.Trim())
        {
            var normalized = NormalizeDigit(character);
            if (char.IsDigit(normalized) || normalized == '+')
            {
                builder.Append(normalized);
            }
        }

        var value = builder.ToString();
        if (value.StartsWith("0098", StringComparison.Ordinal))
        {
            value = $"0{value[4..]}";
        }
        else if (value.StartsWith("+98", StringComparison.Ordinal))
        {
            value = $"0{value[3..]}";
        }
        else if (value.StartsWith("98", StringComparison.Ordinal) && value.Length == 12)
        {
            value = $"0{value[2..]}";
        }

        return value;
    }

    private static string[] BuildMobileVariants(string mobile)
    {
        var variants = new HashSet<string> { mobile };
        if (mobile.StartsWith('0') && mobile.Length > 1)
        {
            variants.Add($"+98{mobile[1..]}");
            variants.Add($"98{mobile[1..]}");
            variants.Add($"0098{mobile[1..]}");
        }

        return variants.ToArray();
    }

    private static char NormalizeDigit(char character) =>
        character switch
        {
            >= '۰' and <= '۹' => (char)('0' + character - '۰'),
            >= '٠' and <= '٩' => (char)('0' + character - '٠'),
            _ => character
        };

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
