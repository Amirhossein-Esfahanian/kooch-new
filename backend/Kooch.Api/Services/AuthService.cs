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
    IHostEnvironment appEnvironment,
    INotificationService notificationService) : IAuthService
{
    private readonly JwtOptions _jwtOptions = jwtOptions.Value;
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan OtpRequestCooldown = TimeSpan.FromSeconds(60);
    private const string InternalEmailDomain = "mobile.kooch.local";

    public async Task<RequestOtpResponse> RegisterAsync(
        RegisterRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.Password != request.ConfirmPassword)
        {
            throw new ArgumentException("Password confirmation does not match.");
        }

        PasswordPolicy.Validate(request.Password);
        var mobile = NormalizeMobile(request.Mobile)
            ?? throw new ArgumentException("Mobile number is required.");
        var email = NormalizeOptionalEmail(request.Email);

        await EnsureUniqueMobileAsync(mobile, null, cancellationToken);
        if (!string.IsNullOrWhiteSpace(email))
        {
            await EnsureUniqueEmailAsync(email, null, cancellationToken);
        }
        await EnsurePassengerGuestCanBeLinkedAsync(mobile, email, cancellationToken);

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email ?? CreateInternalEmail(mobile),
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Client,
            IsActive = false
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
        await CreateOrLinkGuestForPassengerAsync(user, mobile, email, cancellationToken);

        return await CreateAndSendOtpAsync(user, mobile, cancellationToken);
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

        return await CreateAuthResponseAsync(user, cancellationToken);
    }

    public async Task<RequestOtpResponse> RequestOtpAsync(
        RequestOtpRequest request,
        CancellationToken cancellationToken = default)
    {
        var mobile = NormalizeMobile(request.Mobile)
            ?? throw new ArgumentException("Mobile number is required.");
        var user = await FindUserByMobileAsync(mobile, cancellationToken)
            ?? throw new InvalidOperationException("No active account was found for this mobile number.");

        if (user.PasswordSetupRequired || (!user.IsActive && user.Role != UserRole.Client))
        {
            throw new InvalidOperationException("This account cannot use OTP login yet.");
        }

        return await CreateAndSendOtpAsync(user, mobile, cancellationToken);
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
            otp.User.PasswordSetupRequired)
        {
            return null;
        }

        var activeOtps = await dbContext.MobileOtpCodes
            .Where(item => item.Mobile == mobile &&
                           item.UsedAtUtc == null &&
                           item.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);
        foreach (var activeOtp in activeOtps)
        {
            activeOtp.UsedAtUtc = now;
        }

        otp.User.IsActive = true;
        await dbContext.SaveChangesAsync(cancellationToken);
        return await CreateAuthResponseAsync(otp.User, cancellationToken);
    }

    public async Task<string> CreatePasswordSetupTokenAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(user => user.Id == userId, cancellationToken);
        if (user is null)
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
        var setupLink = $"/set-password?token={Uri.EscapeDataString(rawToken)}";
        await notificationService.SendAsync(new NotificationRequest
        {
            EventType = NotificationEventType.PasswordSetupRequested,
            RecipientUserId = user.Id,
            Mobile = user.PhoneNumber,
            Email = IsInternalEmail(user.Email) ? null : user.Email,
            Subject = "Password setup requested",
            Message = "Password setup requested.",
            DataJson = $$"""{"setupLink":"{{setupLink}}"}""",
            Channels = NotificationChannel.InApp | NotificationChannel.Sms | NotificationChannel.Email
        }, cancellationToken);
        return setupLink;
    }

    public async Task SetPasswordAsync(
        SetPasswordRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.NewPassword != request.ConfirmPassword)
        {
            throw new ArgumentException("Password confirmation does not match.");
        }

        PasswordPolicy.Validate(request.NewPassword);
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
                GuestId = user.Guest == null ? null : user.Guest.Id,
                FullName = (user.FirstName + " " + user.LastName).Trim(),
                Email = IsInternalEmail(user.Email) ? string.Empty : user.Email,
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
            new Claim(ClaimTypes.Email, IsInternalEmail(user.Email) ? string.Empty : user.Email),
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

    private async Task<AuthResponse> CreateAuthResponseAsync(
        User user,
        CancellationToken cancellationToken)
    {
        var guestId = await ResolvePassengerGuestIdAsync(user, cancellationToken);
        // var expiresAtUtc = DateTime.UtcNow.AddMinutes(_jwtOptions.ExpiresMinutes);
        var expiresAtUtc = DateTime.UtcNow.AddDays(_jwtOptions.AccessTokenExpirationDays);
        return new AuthResponse
        {
            Token = GenerateJwtToken(user, expiresAtUtc),
            ExpiresAtUtc = expiresAtUtc,
            UserId = user.Id,
            GuestId = guestId,
            FullName = $"{user.FirstName} {user.LastName}".Trim(),
            Email = IsInternalEmail(user.Email) ? string.Empty : user.Email,
            Role = user.Role
        };
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static string? NormalizeOptionalEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) ? null : NormalizeEmail(email);

    private static string CreateInternalEmail(string mobile) =>
        $"{mobile}@{InternalEmailDomain}";

    private static bool IsInternalEmail(string? email) =>
        email?.EndsWith($"@{InternalEmailDomain}", StringComparison.OrdinalIgnoreCase) == true;

    private async Task EnsureUniqueEmailAsync(
        string email,
        int? excludedUserId,
        CancellationToken cancellationToken)
    {
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.Email == email &&
                              (!excludedUserId.HasValue || user.Id != excludedUserId.Value),
                cancellationToken))
        {
            throw new ArgumentException("این ایمیل قبلاً ثبت شده است.");
        }
    }

    private async Task EnsureUniqueMobileAsync(
        string mobile,
        int? excludedUserId,
        CancellationToken cancellationToken)
    {
        var variants = BuildMobileVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.PhoneNumber != null &&
                              variants.Contains(user.PhoneNumber) &&
                              (!excludedUserId.HasValue || user.Id != excludedUserId.Value),
                cancellationToken))
        {
            throw new ArgumentException("این شماره موبایل قبلاً ثبت شده است.");
        }
    }

    private async Task<RequestOtpResponse> CreateAndSendOtpAsync(
        User user,
        string mobile,
        CancellationToken cancellationToken)
    {
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

        await notificationService.SendAsync(new NotificationRequest
        {
            EventType = NotificationEventType.OtpRequested,
            RecipientUserId = user.Id,
            Mobile = mobile,
            Email = IsInternalEmail(user.Email) ? null : user.Email,
            Subject = "OTP requested",
            Message = "OTP requested.",
            DataJson = appEnvironment.IsDevelopment()
                ? $$"""{"devOtpCode":"{{rawCode}}","expiresAtUtc":"{{expiresAtUtc:O}}"}"""
                : $$"""{"expiresAtUtc":"{{expiresAtUtc:O}}"}""",
            Channels = NotificationChannel.InApp | NotificationChannel.Sms
        }, cancellationToken);

        return new RequestOtpResponse
        {
            Sent = true,
            ExpiresAtUtc = expiresAtUtc,
            DevOtpCode = appEnvironment.IsDevelopment() ? rawCode : null
        };
    }

    private async Task CreateOrLinkGuestForPassengerAsync(
        User user,
        string mobile,
        string? email,
        CancellationToken cancellationToken)
    {
        var (guest, hasConflict) = await FindPassengerGuestLinkCandidateAsync(
            mobile,
            email,
            user.Id,
            cancellationToken);
        if (hasConflict)
        {
            throw new ArgumentException("A guest already exists for this mobile or email.");
        }

        if (guest is not null)
        {
            if (guest.UserId.HasValue && guest.UserId.Value != user.Id)
            {
                throw new ArgumentException("A guest already exists for this mobile or email.");
            }

            guest.UserId = user.Id;
            guest.FirstName = string.IsNullOrWhiteSpace(guest.FirstName) ? user.FirstName : guest.FirstName;
            guest.LastName = string.IsNullOrWhiteSpace(guest.LastName) ? user.LastName : guest.LastName;
            guest.Mobile ??= mobile;
            guest.NormalizedMobile ??= mobile;
            guest.Email ??= email;
            guest.NormalizedEmail ??= email;
            guest.Nationality ??= "ایران";
            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        dbContext.Guests.Add(new Guest
        {
            UserId = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Mobile = mobile,
            NormalizedMobile = mobile,
            Email = email,
            NormalizedEmail = email,
            Nationality = "ایران"
        });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsurePassengerGuestCanBeLinkedAsync(
        string mobile,
        string? email,
        CancellationToken cancellationToken)
    {
        var (_, hasConflict) = await FindPassengerGuestLinkCandidateAsync(
            mobile,
            email,
            null,
            cancellationToken);
        if (hasConflict)
        {
            throw new ArgumentException("A passenger account already exists for this guest.");
        }
    }

    private async Task<int?> ResolvePassengerGuestIdAsync(
        User user,
        CancellationToken cancellationToken)
    {
        if (user.Role != UserRole.Client)
        {
            return null;
        }

        var linkedGuestId = await dbContext.Guests
            .Where(guest => guest.UserId == user.Id)
            .Select(guest => (int?)guest.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (linkedGuestId.HasValue)
        {
            return linkedGuestId.Value;
        }

        var mobile = NormalizeMobile(user.PhoneNumber);
        var email = IsInternalEmail(user.Email) ? null : NormalizeOptionalEmail(user.Email);
        if (mobile is null && email is null)
        {
            return null;
        }

        var (guest, hasConflict) = await FindPassengerGuestLinkCandidateAsync(
            mobile,
            email,
            user.Id,
            cancellationToken);
        if (hasConflict)
        {
            return null;
        }

        if (guest is not null)
        {
            guest.UserId = user.Id;
            guest.FirstName = string.IsNullOrWhiteSpace(guest.FirstName) ? user.FirstName : guest.FirstName;
            guest.LastName = string.IsNullOrWhiteSpace(guest.LastName) ? user.LastName : guest.LastName;
            guest.Mobile ??= mobile;
            guest.NormalizedMobile ??= mobile;
            guest.Email ??= email;
            guest.NormalizedEmail ??= email;
            guest.Nationality ??= "Ø§ÛŒØ±Ø§Ù†";
            await dbContext.SaveChangesAsync(cancellationToken);
            return guest.Id;
        }

        var newGuest = new Guest
        {
            UserId = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Mobile = mobile,
            NormalizedMobile = mobile,
            Email = email,
            NormalizedEmail = email,
            Nationality = "Ø§ÛŒØ±Ø§Ù†"
        };
        dbContext.Guests.Add(newGuest);
        await dbContext.SaveChangesAsync(cancellationToken);
        return newGuest.Id;
    }

    private async Task<(Guest? Guest, bool HasConflict)> FindPassengerGuestLinkCandidateAsync(
        string? mobile,
        string? email,
        int? userId,
        CancellationToken cancellationToken)
    {
        if (mobile is null && email is null)
        {
            return (null, false);
        }

        var guests = await dbContext.Guests
            .Where(guest =>
                (mobile != null && guest.NormalizedMobile == mobile) ||
                (email != null && guest.NormalizedEmail == email))
            .ToListAsync(cancellationToken);
        if (guests.Count == 0)
        {
            return (null, false);
        }

        if (userId.HasValue)
        {
            var alreadyLinked = guests.SingleOrDefault(guest => guest.UserId == userId.Value);
            if (alreadyLinked is not null)
            {
                return (alreadyLinked, false);
            }
        }

        if (guests.Any(guest => guest.UserId.HasValue) ||
            guests.Select(guest => guest.Id).Distinct().Count() > 1)
        {
            return (null, true);
        }

        return (guests[0], false);
    }

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

}
