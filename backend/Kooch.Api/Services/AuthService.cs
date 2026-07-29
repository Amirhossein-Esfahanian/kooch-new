using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.Users;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Kooch.Api.Services;

public class AuthService(
    KoochDbContext dbContext,
    IOptions<JwtOptions> jwtOptions,
    IPropertyAuthorizationService propertyAuthorizationService,
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
        var identity = CreateUserIdentity(request.FirstName, request.LastName, request.Mobile, request.Email);
        var mobile = identity.PhoneNumber;
        var email = identity.Email;

        await EnsureUniqueMobileAsync(mobile, null, cancellationToken);
        if (!string.IsNullOrWhiteSpace(email))
        {
            await EnsureUniqueEmailAsync(email, null, cancellationToken);
        }
        await EnsurePassengerGuestCanBeLinkedAsync(mobile, email, cancellationToken);

        var user = new User
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
            Email = email,
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
        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile)
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
        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile);
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

        var now = DateTime.UtcNow;
        var activeTokens = await dbContext.PasswordSetupTokens
            .Where(token =>
                token.UserId == userId &&
                token.UsedAtUtc == null &&
                token.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);
        foreach (var activeToken in activeTokens)
        {
            activeToken.UsedAtUtc = now;
        }

        var rawToken = CreateRawToken();
        dbContext.PasswordSetupTokens.Add(new PasswordSetupToken
        {
            UserId = userId,
            TokenHash = HashToken(rawToken),
            ExpiresAtUtc = now.AddHours(24)
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        var setupLink = $"/set-password?token={Uri.EscapeDataString(rawToken)}";
        await notificationService.SendAsync(new NotificationRequest
        {
            EventType = NotificationEventType.PasswordSetupRequested,
            RecipientUserId = user.Id,
            Mobile = user.PhoneNumber,
            Email = GetContactEmail(user.Email),
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
        var now = DateTime.UtcNow;
        var setupToken = await FindPasswordSetupTokenAsync(request.Token, cancellationToken);
        var status = GetPasswordSetupTokenStatus(setupToken, now);
        if (status != PasswordSetupTokenStatus.Valid)
        {
            throw CreatePasswordSetupTokenException(status);
        }

        setupToken!.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        setupToken.User.PasswordSetupRequired = false;
        setupToken.User.InvitationAcceptedAtUtc = now;
        setupToken.User.IsActive = true;
        setupToken.User.SecurityStampVersion++;
        setupToken.UsedAtUtc = now;

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(
        string token,
        CancellationToken cancellationToken = default)
    {
        var setupToken = await FindPasswordSetupTokenAsync(token, cancellationToken);
        return new PasswordSetupTokenStatusResponse
        {
            Status = GetPasswordSetupTokenStatus(setupToken, DateTime.UtcNow)
        };
    }

    private async Task<PasswordSetupToken?> FindPasswordSetupTokenAsync(
        string rawToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return null;
        }

        var tokenHash = HashToken(rawToken);
        return await dbContext.PasswordSetupTokens
            .Include(token => token.User)
            .SingleOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken);
    }

    private static PasswordSetupTokenStatus GetPasswordSetupTokenStatus(
        PasswordSetupToken? setupToken,
        DateTime now)
    {
        if (setupToken?.User is null ||
            setupToken.UserId != setupToken.User.Id ||
            setupToken.User.IsDeleted)
        {
            return PasswordSetupTokenStatus.Invalid;
        }

        if (setupToken.UsedAtUtc.HasValue)
        {
            return PasswordSetupTokenStatus.Used;
        }

        if (setupToken.ExpiresAtUtc <= now)
        {
            return PasswordSetupTokenStatus.Expired;
        }

        if (!setupToken.User.PasswordSetupRequired &&
            !string.IsNullOrWhiteSpace(setupToken.User.PasswordHash))
        {
            return PasswordSetupTokenStatus.Used;
        }

        return PasswordSetupTokenStatus.Valid;
    }

    private static InvalidOperationException CreatePasswordSetupTokenException(
        PasswordSetupTokenStatus status) => status switch
    {
        PasswordSetupTokenStatus.Expired => new InvalidOperationException("Password setup token has expired."),
        PasswordSetupTokenStatus.Used => new InvalidOperationException("Password setup token has already been used or revoked."),
        _ => new InvalidOperationException("Password setup token is invalid.")
    };

    public async Task<CurrentUserResponse?> GetCurrentUserAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => new
            {
                user.Id,
                user.FirstName,
                user.LastName,
                user.Email,
                user.PhoneNumber,
                user.Role,
                user.IsActive,
                GuestId = user.Guest == null ? null : (int?)user.Guest.Id
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return null;
        }

        var memberships = await dbContext.UserPropertyAccesses.AsNoTracking()
            .Where(access => access.UserId == userId)
            .OrderBy(access => access.Property.Name)
            .ThenBy(access => access.PropertyId)
            .Select(access => new
            {
                access.PropertyId,
                PropertyName = access.Property.Name,
                access.PropertyRole,
                access.Status,
                access.IsActive
            })
            .ToListAsync(cancellationToken);

        var membershipResponses = new List<CurrentUserPropertyMembershipResponse>();
        var activePropertyIds = new List<int>();
        foreach (var membership in memberships)
        {
            var effective = await propertyAuthorizationService.GetEffectivePropertyPermissionsAsync(
                userId,
                membership.PropertyId,
                cancellationToken);
            var hasActiveAccess = membership.IsActive &&
                                  membership.Status == PropertyUserStatus.Active &&
                                  effective is not null;
            if (hasActiveAccess)
            {
                activePropertyIds.Add(membership.PropertyId);
            }

            membershipResponses.Add(new CurrentUserPropertyMembershipResponse
            {
                PropertyId = membership.PropertyId,
                PropertyName = membership.PropertyName,
                PropertyRole = membership.PropertyRole,
                MembershipStatus = membership.Status,
                IsActive = membership.IsActive,
                EffectivePermissions = effective?.PermissionMatrix ??
                    PropertyPermissionMatrixDefaults.CreateEmpty()
            });
        }

        var platformRole = user.Role.ToCanonicalPlatformRole();
        var platformPermissions = await ResolvePlatformPermissionsAsync(user.Id, platformRole, cancellationToken);
        var workspaces = new List<string>();
        if (platformRole.IsPlatformAdmin())
        {
            workspaces.Add(WorkspaceNames.Admin);
        }
        if (activePropertyIds.Count > 0)
        {
            workspaces.Add(WorkspaceNames.Owner);
        }
        workspaces.Add(WorkspaceNames.Account);

        var defaultWorkspace = workspaces.Contains(WorkspaceNames.Admin)
            ? WorkspaceNames.Admin
            : workspaces.Contains(WorkspaceNames.Owner)
                ? WorkspaceNames.Owner
                : workspaces.Contains(WorkspaceNames.Account)
                    ? WorkspaceNames.Account
                    : null;

        return new CurrentUserResponse
        {
            UserId = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            GuestId = user.GuestId,
            FullName = (user.FirstName + " " + user.LastName).Trim(),
            Email = GetDisplayEmail(user.Email),
            PhoneNumber = user.PhoneNumber,
            PlatformRole = platformRole,
            PlatformPermissions = platformPermissions,            IsActive = user.IsActive,
            Workspaces = workspaces,
            PropertyMemberships = membershipResponses,
            DefaultWorkspace = defaultWorkspace,
            DefaultPropertyId = activePropertyIds.OrderBy(id => id).Cast<int?>().FirstOrDefault()
        };
    }

    private async Task<IReadOnlyList<PermissionKey>> ResolvePlatformPermissionsAsync(
        int userId,
        UserRole platformRole,
        CancellationToken cancellationToken)
    {
        if (platformRole == UserRole.SuperAdmin)
        {
            return Enum.GetValues<PermissionKey>();
        }

        if (platformRole != UserRole.AdminAssistant)
        {
            return [];
        }

        return await dbContext.UserPermissions.AsNoTracking()
            .Where(permission =>
                permission.UserId == userId &&
                permission.IsAllowed)
            .Select(permission => permission.PermissionKey)
            .Distinct()
            .OrderBy(permission => permission)
            .ToListAsync(cancellationToken);
    }
    public string GenerateJwtToken(User user, DateTime expiresAtUtc)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, $"{user.FirstName} {user.LastName}".Trim()),
            new Claim(ClaimTypes.Email, GetDisplayEmail(user.Email)),
            new Claim(ClaimTypes.Role, user.Role.ToCanonicalPlatformRole().ToString()),
            new Claim(KoochJwtClaimTypes.SessionVersion, user.SecurityStampVersion.ToString(CultureInfo.InvariantCulture)),
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
            Email = GetDisplayEmail(user.Email),
            Role = user.Role.ToCanonicalPlatformRole()
        };
    }


    private static UserIdentityInput CreateUserIdentity(
        string firstName,
        string lastName,
        string phoneNumber,
        string? email)
    {
        var normalizedPhone = UserIdentityNormalization.NormalizePhoneNumber(phoneNumber)
            ?? throw new ArgumentException("Mobile number is required.");
        return new UserIdentityInput(
            UserIdentityNormalization.NormalizeName(firstName),
            UserIdentityNormalization.NormalizeName(lastName),
            normalizedPhone,
            UserIdentityNormalization.NormalizeEmail(email));
    }

    private static string GetDisplayEmail(string? email) => GetContactEmail(email) ?? string.Empty;

    private static string? GetContactEmail(string? email) => IsInternalEmail(email) ? null : email;
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
            throw new ArgumentException("\u0627\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A.");
        }
    }

    private async Task EnsureUniqueMobileAsync(
        string mobile,
        int? excludedUserId,
        CancellationToken cancellationToken)
    {
        var variants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
            .AnyAsync(user => user.PhoneNumber != null &&
                              variants.Contains(user.PhoneNumber) &&
                              (!excludedUserId.HasValue || user.Id != excludedUserId.Value),
                cancellationToken))
        {
            throw new ArgumentException("\u0627\u06CC\u0646 \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A.");
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
            Email = GetContactEmail(user.Email),
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
            guest.Nationality ??= "\u0627\u06CC\u0631\u0627\u0646";
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
            Nationality = "\u0627\u06CC\u0631\u0627\u0646"
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

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(user.PhoneNumber);
        var email = IsInternalEmail(user.Email) ? null : UserIdentityNormalization.NormalizeEmail(user.Email);
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
            guest.Nationality ??= "\u0627\u06CC\u0631\u0627\u0646";
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
            Nationality = "\u0627\u06CC\u0631\u0627\u0646"
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
            var email = UserIdentityNormalization.NormalizeEmail(identifier);
            return await dbContext.Users
                .SingleOrDefaultAsync(user => user.Email == email, cancellationToken);
        }

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(identifier);
        return string.IsNullOrWhiteSpace(mobile)
            ? null
            : await FindUserByMobileAsync(mobile, cancellationToken);
    }

    private async Task<User?> FindUserByMobileAsync(
        string mobile,
        CancellationToken cancellationToken)
    {
        var variants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
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


    private static char NormalizeDigit(char character) =>
        character switch
        {
            >= '\u06F0' and <= '\u06F9' => (char)('0' + character - '\u06F0'),
            >= '\u0660' and <= '\u0669' => (char)('0' + character - '\u0660'),
            _ => character
        };

}




