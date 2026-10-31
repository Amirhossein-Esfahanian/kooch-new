using System.Globalization;
using System.Data;
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
using Microsoft.Data.SqlClient;
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
    INotificationService notificationService,
    IWelcomeGiftGrantService? welcomeGiftGrantService = null) : IAuthService
{
    private readonly JwtOptions _jwtOptions = jwtOptions.Value;
    private readonly IWelcomeGiftGrantService giftGrantService =
        welcomeGiftGrantService ?? new WelcomeGiftGrantService(dbContext, TimeProvider.System);
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan OtpRequestCooldown = TimeSpan.FromSeconds(60);
    private const int MaxOtpVerificationAttempts = 3;
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
        var nationalCode = NormalizeRequiredRegistrationNationalCode(request.NationalCode);
        var mobile = identity.PhoneNumber;
        var email = identity.Email;

        await EnsureUniqueMobileAsync(mobile, null, cancellationToken);
        if (!string.IsNullOrWhiteSpace(email))
        {
            await EnsureUniqueEmailAsync(email, null, cancellationToken);
        }

        var user = new User
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
            Email = email,
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            PendingRegistrationNationalCode = nationalCode,
            Role = UserRole.Client,
            IsActive = false
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);
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
        var user = await FindUserByMobileAsync(mobile, cancellationToken);

        if (user is null && request.AllowRegistration)
        {
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName))
            {
                return new RequestOtpResponse
                {
                    Sent = false,
                    RequiresRegistration = true
                };
            }

            var identity = CreateUserIdentity(
                request.FirstName,
                request.LastName,
                mobile,
                request.Email);
            var nationalCode = NormalizeRequiredRegistrationNationalCode(request.NationalCode);
            if (!string.IsNullOrWhiteSpace(identity.Email))
            {
                await EnsureUniqueEmailAsync(identity.Email, null, cancellationToken);
            }
            await EnsureUniqueMobileAsync(identity.PhoneNumber, null, cancellationToken);

            user = new User
            {
                FirstName = identity.FirstName,
                LastName = identity.LastName,
                Email = identity.Email,
                PhoneNumber = identity.PhoneNumber,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(
                    Convert.ToHexString(RandomNumberGenerator.GetBytes(32))),
                PendingRegistrationNationalCode = nationalCode,
                Role = UserRole.Client,
                IsActive = false
            };

            dbContext.Users.Add(user);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        if (user is null)
        {
            throw new InvalidOperationException(
                "No active account was found for this mobile number.");
        }

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
        for (var attempt = 1; ; attempt++)
        {
            User? user;
            try
            {
                user = await VerifyOtpAttemptAsync(request, cancellationToken);
            }
            catch (Exception exception) when (dbContext.Database.IsSqlServer() && IsSqlServerDeadlock(exception))
            {
                // The attempt has disposed its transaction; none of its tracked state may be reused.
                dbContext.ChangeTracker.Clear();
                if (attempt >= MaxOtpVerificationAttempts)
                    throw new OtpVerificationUnavailableException(exception);
                await Task.Delay(TimeSpan.FromMilliseconds(50 * attempt + RandomNumberGenerator.GetInt32(50)),
                    cancellationToken);
                continue;
            }

            // Response construction is outside the retry boundary: the OTP transaction is already committed.
            return user is null ? null : await CreateAuthResponseAsync(user, cancellationToken);
        }
    }

    private static bool IsSqlServerDeadlock(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
            if (current is SqlException { Number: 1205 }) return true;
        return false;
    }

    private async Task<User?> VerifyOtpAttemptAsync(
        VerifyOtpRequest request,
        CancellationToken cancellationToken)
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
        var otp = await dbContext.MobileOtpCodes.AsNoTracking()
            .Where(item => item.Mobile == mobile && item.CodeHash == codeHash)
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        if (otp is null ||
            otp.UsedAtUtc.HasValue ||
            otp.ExpiresAtUtc <= now)
        {
            return null;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, cancellationToken);
        var user = dbContext.Database.IsSqlServer()
            ? await dbContext.Users.FromSqlInterpolated(
                $"SELECT * FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Id = {otp.UserId}")
                .SingleAsync(cancellationToken)
            : await dbContext.Users.SingleAsync(item => item.Id == otp.UserId, cancellationToken);
        if (user.PasswordSetupRequired ||
            UserIdentityNormalization.NormalizePhoneNumber(user.PhoneNumber) != mobile)
        {
            return null;
        }
        var isNewRegistration = !user.IsActive && user.PendingRegistrationNationalCode is not null;

        var lockTimeUtc = DateTime.UtcNow;
        var activeOtps = dbContext.Database.IsSqlServer()
            ? dbContext.MobileOtpCodes.FromSqlInterpolated(
                $"SELECT * FROM [MobileOtpCodes] WITH (UPDLOCK, HOLDLOCK, INDEX(IX_MobileOtpCodes_Mobile_UsedAtUtc_ExpiresAtUtc)) WHERE [Mobile] = {mobile} AND [UsedAtUtc] IS NULL AND [ExpiresAtUtc] > {lockTimeUtc}")
            : dbContext.MobileOtpCodes.Where(item =>
                item.Mobile == mobile && item.UsedAtUtc == null && item.ExpiresAtUtc > lockTimeUtc);
        // Lock this mobile's active codes before changing any OTP index keys.
        var activeOtpIds = await activeOtps.AsNoTracking().OrderBy(item => item.Id)
            .Select(item => item.Id).ToArrayAsync(cancellationToken);
        var verifiedAtUtc = DateTime.UtcNow;
        var claimed = await dbContext.MobileOtpCodes
            .Where(item => item.Id == otp.Id && item.UsedAtUtc == null && item.ExpiresAtUtc > verifiedAtUtc)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.UsedAtUtc, verifiedAtUtc), cancellationToken);
        if (claimed != 1)
        {
            return null;
        }

        foreach (var activeOtpId in activeOtpIds.Where(id => id != otp.Id))
        {
            await dbContext.MobileOtpCodes
                .Where(item => item.Id == activeOtpId && item.UsedAtUtc == null && item.ExpiresAtUtc > verifiedAtUtc)
                .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.UsedAtUtc, verifiedAtUtc), cancellationToken);
        }
        user.IsActive = true;
        await dbContext.SaveChangesAsync(cancellationToken);
        await LinkVerifiedMobileGuestAsync(user, mobile, cancellationToken);
        if (isNewRegistration)
            await giftGrantService.TryGrantForVerifiedRegistrationAsync(user, cancellationToken);
        if (user.PendingRegistrationNationalCode is not null)
        {
            user.PendingRegistrationNationalCode = null;
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return user;
    }

    public async Task<string> CreatePasswordSetupTokenAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var setupLink = await CreatePasswordSetupTokenWithoutNotificationAsync(userId, cancellationToken);
        await SendPasswordSetupNotificationAsync(userId, setupLink, cancellationToken);
        return setupLink;
    }

    public async Task<string> CreatePasswordSetupTokenWithoutNotificationAsync(
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
        return $"/set-password?token={Uri.EscapeDataString(rawToken)}";
    }

    public async Task SendPasswordSetupNotificationAsync(
        int userId,
        string setupLink,
        CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.IgnoreQueryFilters()
            .SingleOrDefaultAsync(user => user.Id == userId, cancellationToken)
            ?? throw new KeyNotFoundException("User not found.");
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
                GuestId = user.Guest == null ? null : (int?)user.Guest.Id,
                LinkedGuest = user.Guest == null
                    ? null
                    : new CurrentUserLinkedGuestResponse
                    {
                        FirstName = user.Guest.FirstName,
                        LastName = user.Guest.LastName,
                        Mobile = user.Guest.Mobile,
                        Email = user.Guest.Email,
                        NationalCode = user.Guest.NationalCode
                    }
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
            LinkedGuest = user.LinkedGuest,
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

    public async Task<CurrentUserResponse?> UpdateCurrentUserProfileAsync(
        int userId,
        UpdateCurrentUserProfileRequest request,
        CancellationToken cancellationToken = default)
    {
        var firstName = NormalizeRequiredProfileName(request.FirstName, "First name");
        var lastName = NormalizeRequiredProfileName(request.LastName, "Last name");
        var user = await dbContext.Users
            .SingleOrDefaultAsync(user => user.Id == userId && user.IsActive, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.FirstName = firstName;
        user.LastName = lastName;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await GetCurrentUserAsync(userId, cancellationToken);
    }

    private static string NormalizeRequiredProfileName(string? value, string fieldName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{fieldName} is required.");
        }

        var normalized = UserIdentityNormalization.NormalizeName(value);
        if (normalized.Length > 100)
        {
            throw new ArgumentException($"{fieldName} cannot exceed 100 characters.");
        }

        return normalized;
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
        var guestId = user.Role == UserRole.Client
            ? await dbContext.Guests.AsNoTracking()
                .Where(guest => guest.UserId == user.Id)
                .Select(guest => (int?)guest.Id)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
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


    private static string NormalizeRequiredRegistrationNationalCode(string? nationalCode)
    {
        if (!GuestNormalization.IsValidIranianNationalCode(nationalCode))
        {
            throw new ArgumentException("A valid Iranian NationalId is required.");
        }

        return GuestNormalization.NormalizeNationalCode(nationalCode)!;
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
            RequiresRegistration = false,
            ExpiresAtUtc = expiresAtUtc,
            DevOtpCode = appEnvironment.IsDevelopment() ? rawCode : null
        };
    }

    private async Task LinkVerifiedMobileGuestAsync(
        User user,
        string verifiedMobile,
        CancellationToken cancellationToken)
    {
        if (user.Role != UserRole.Client ||
            await dbContext.Guests.AnyAsync(guest => guest.UserId == user.Id, cancellationToken))
        {
            return;
        }

        var candidates = await dbContext.Guests.AsNoTracking()
            .Where(guest => guest.NormalizedMobile == verifiedMobile)
            .Take(2)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 1 && candidates[0].UserId is null)
        {
            var candidateId = candidates[0].Id;
            var linked = await dbContext.Guests
                .Where(guest => guest.Id == candidateId && guest.UserId == null)
                .ExecuteUpdateAsync(setters => setters.SetProperty(guest => guest.UserId, user.Id), cancellationToken);
            if (linked == 1)
            {
                return;
            }
        }

        // Ambiguous or already-owned contact records are never transferred to this User.
        dbContext.Guests.Add(new Guest
        {
            UserId = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Mobile = verifiedMobile,
            NormalizedMobile = verifiedMobile,
            Nationality = "\u0627\u06CC\u0631\u0627\u0646"
        });
        await dbContext.SaveChangesAsync(cancellationToken);
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




