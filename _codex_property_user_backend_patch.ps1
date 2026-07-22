$ErrorActionPreference = "Stop"

function Read-Normalized([string]$Path) {
    return [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path).Replace("`r`n", "`n")
}

function Write-Source([string]$Path, [string]$Text, [bool]$Bom = $false) {
    [IO.File]::WriteAllText(
        (Resolve-Path -LiteralPath $Path).Path,
        $Text.Replace("`n", "`r`n"),
        [Text.UTF8Encoding]::new($Bom)
    )
}

function Replace-Exact([string]$Text, [string]$Old, [string]$New) {
    if (-not $Text.Contains($Old)) {
        throw "Expected source fragment was not found."
    }
    return $Text.Replace($Old, $New)
}

function Replace-Between(
    [string]$Text,
    [string]$StartMarker,
    [string]$EndMarker,
    [string]$Replacement
) {
    $start = $Text.IndexOf($StartMarker)
    $end = $Text.IndexOf($EndMarker, $start)
    if ($start -lt 0 -or $end -lt 0) {
        throw "Replacement boundary was not found."
    }
    return $Text.Substring(0, $start) + $Replacement + $Text.Substring($end)
}

$requestPath = "backend/Kooch.Api/Dtos/PropertyUsers/PropertyUserRequest.cs"
$requestText = Read-Normalized $requestPath
$requestText = Replace-Exact $requestText `
    @'
    [Required, MaxLength(200)]
    public string FullName { get; set; } = string.Empty;
'@ `
    @'
    [MaxLength(200)]
    public string? FullName { get; set; }
'@
Write-Source $requestPath $requestText

$interfacePath = "backend/Kooch.Api/Services/IPropertyUserService.cs"
$interfaceText = Read-Normalized $interfacePath
$interfaceText = Replace-Exact $interfaceText `
    '    Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(int currentUserId, UserRole currentRole, int propertyId, CancellationToken cancellationToken = default);' `
    @'
    Task<IReadOnlyList<PropertyUserResponse>> GetUsersAsync(int currentUserId, UserRole currentRole, int propertyId, CancellationToken cancellationToken = default);
    Task<PropertyUserCandidateResponse> ResolveCandidateAsync(int currentUserId, int propertyId, PropertyUserCandidateRequest request, CancellationToken cancellationToken = default);
'@
Write-Source $interfacePath $interfaceText

foreach ($controllerPath in @(
    "backend/Kooch.Api/Controllers/PropertyUsersController.cs",
    "backend/Kooch.Api/Controllers/AdminPropertyUsersController.cs"
)) {
    $controllerText = Read-Normalized $controllerPath
    $getMarker = @'
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyUserResponse>>(StatusCodes.Status200OK)]
'@
    $resolveAction = @'
    [HttpPost("resolve")]
    [ProducesResponseType<PropertyUserCandidateResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyUserCandidateResponse>> ResolveCandidate(
        int propertyId,
        PropertyUserCandidateRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyUserService.ResolveCandidateAsync(
            user.UserId,
            propertyId,
            request,
            cancellationToken));
    }

'@
    $controllerText = Replace-Exact $controllerText $getMarker ($resolveAction + $getMarker)
    Write-Source $controllerPath $controllerText $true
}

$servicePath = "backend/Kooch.Api/Services/PropertyUserService.cs"
$serviceText = Read-Normalized $servicePath

$serviceText = Replace-Exact $serviceText `
    @'
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IPropertyAuthorizationService propertyAuthorizationService,
'@ `
    @'
    KoochDbContext dbContext,
    IPropertyAuthorizationService propertyAuthorizationService,
'@

$createStart = @'
    public async Task<PropertyUserResponse> CreateUserAsync(
'@
$updateStart = @'
    public async Task<PropertyUserResponse> UpdateUserAsync(
'@
$newCreateBlock = @'
    public async Task<PropertyUserCandidateResponse> ResolveCandidateAsync(
        int currentUserId,
        int propertyId,
        PropertyUserCandidateRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(
            currentUserId,
            propertyId,
            "users.create",
            cancellationToken);

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile);
        if (mobile is null)
        {
            return UnavailableCandidate();
        }

        var users = await FindUsersByMobileAsync(mobile, cancellationToken);
        if (users.Count > 1)
        {
            return UnavailableCandidate();
        }

        var user = users.SingleOrDefault();
        if (user is null)
        {
            var conflictsWithGuest = await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.NormalizedMobile == mobile, cancellationToken);
            return conflictsWithGuest
                ? UnavailableCandidate()
                : new PropertyUserCandidateResponse
                {
                    Outcome = PropertyUserCandidateOutcome.CanContinue,
                    RequiresUserCreation = true
                };
        }

        if (user.IsDeleted)
        {
            return UnavailableCandidate();
        }

        var alreadyMember = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .AnyAsync(
                access => access.UserId == user.Id && access.PropertyId == propertyId,
                cancellationToken);
        if (alreadyMember)
        {
            return new PropertyUserCandidateResponse
            {
                Outcome = PropertyUserCandidateOutcome.AlreadyMember
            };
        }

        return new PropertyUserCandidateResponse
        {
            Outcome = PropertyUserCandidateOutcome.CanContinue,
            RequiresUserCreation = false,
            MaskedName = MaskName(user)
        };
    }

    public async Task<PropertyUserResponse> CreateUserAsync(
        int currentUserId,
        UserRole currentRole,
        int propertyId,
        PropertyUserRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanUseUsersPermissionAsync(currentUserId, propertyId, "users.create", cancellationToken);
        if (request.Role == PropertyUserRole.PropertyOwner)
        {
            throw new InvalidOperationException("Property owner cannot be created from this page.");
        }
        await EnsureCanManageTargetRoleAsync(
            currentUserId,
            propertyId,
            request.Role,
            "create",
            cancellationToken);

        var permissions = request.Permissions
            ?? PropertyPermissionMatrixDefaults.CreateForRole(request.Role);
        await EnsureCanGrantPermissionsAsync(
            currentUserId,
            propertyId,
            permissions,
            null,
            cancellationToken);

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(request.Mobile)
            ?? throw new ArgumentException("شماره موبایل را وارد کنید.");

        await using var transaction = dbContext.Database.IsRelational()
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var matchingUsers = await FindUsersByMobileAsync(mobile, cancellationToken);
        if (matchingUsers.Count > 1)
        {
            throw CandidateUnavailableException();
        }

        var user = matchingUsers.SingleOrDefault();
        var isNewUser = user is null;
        if (user is { IsDeleted: true })
        {
            throw CandidateUnavailableException();
        }

        if (user is null)
        {
            var conflictsWithGuestMobile = await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.NormalizedMobile == mobile, cancellationToken);
            if (conflictsWithGuestMobile || string.IsNullOrWhiteSpace(request.FullName))
            {
                throw CandidateUnavailableException();
            }

            var identity = CreateUserIdentityFromFullName(
                request.FullName,
                mobile,
                request.Email);
            var email = identity.Email;
            var hasIdentityConflict =
                email is not null &&
                (await dbContext.Users.IgnoreQueryFilters()
                     .AnyAsync(item => item.Email == email, cancellationToken) ||
                 await dbContext.Guests.AsNoTracking()
                     .AnyAsync(guest => guest.NormalizedEmail == email, cancellationToken));
            if (hasIdentityConflict)
            {
                throw CandidateUnavailableException();
            }

            user = new User
            {
                FirstName = identity.FirstName,
                LastName = identity.LastName,
                Email = email,
                Username = email ?? mobile,
                PhoneNumber = mobile,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
                Role = UserRole.Client,
                ParentUserId = currentUserId,
                IsActive = false,
                PasswordSetupRequired = true
            };
            dbContext.Users.Add(user);
        }

        var duplicateMembership = await dbContext.UserPropertyAccesses
            .IgnoreQueryFilters()
            .AnyAsync(
                access => access.UserId == user.Id && access.PropertyId == propertyId,
                cancellationToken);
        if (duplicateMembership)
        {
            throw new InvalidOperationException("این کاربر قبلاً عضو این اقامتگاه است.");
        }

        var access = new UserPropertyAccess
        {
            User = user,
            PropertyId = propertyId,
            PropertyRole = request.Role,
            Status = request.Status
        };
        dbContext.UserPropertyAccesses.Add(access);
        ApplyRequest(access, request);

        if (NeedsPasswordSetup(user))
        {
            user.PasswordSetupRequired = true;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        var setupLink = string.Empty;
        if (NeedsPasswordSetup(user))
        {
            setupLink = await authService.CreatePasswordSetupTokenAsync(
                user.Id,
                cancellationToken);
        }

        var response = (await GetUsersAsync(
                currentUserId,
                currentRole,
                propertyId,
                cancellationToken))
            .Single(item => item.UserId == user.Id);
        if (!string.IsNullOrWhiteSpace(setupLink) && appEnvironment.IsDevelopment())
        {
            response.TemporarySetupLink = setupLink;
        }

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return response;
    }

'@
$serviceText = Replace-Between $serviceText $createStart $updateStart $newCreateBlock

$serviceText = Replace-Exact $serviceText `
    @'
        var allowed = await permissionService.CanAsync(
            currentUserId,
            propertyId,
            permissionKey,
            cancellationToken);
'@ `
    @'
        var allowed = await propertyAuthorizationService.HasPropertyPermissionAsync(
            currentUserId,
            propertyId,
            permissionKey,
            cancellationToken);
'@

$serviceText = Replace-Exact $serviceText `
    @'
            if (!await permissionService.CanAsync(currentUserId, propertyId, permissionKey, cancellationToken))
'@ `
    @'
            if (!await propertyAuthorizationService.HasPropertyPermissionAsync(
                    currentUserId,
                    propertyId,
                    permissionKey,
                    cancellationToken))
'@

$oldResolveStart = @'
    private async Task<User?> ResolveUserForInvitationAsync(
'@
$needsPasswordStart = @'
    private static bool NeedsPasswordSetup(User user) =>
'@
$candidateHelpers = @'
    private async Task<List<User>> FindUsersByMobileAsync(
        string mobile,
        CancellationToken cancellationToken)
    {
        var variants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        return await dbContext.Users.IgnoreQueryFilters()
            .Where(user =>
                user.PhoneNumber != null &&
                variants.Contains(user.PhoneNumber))
            .OrderBy(user => user.Id)
            .ToListAsync(cancellationToken);
    }

    private static PropertyUserCandidateResponse UnavailableCandidate() => new()
    {
        Outcome = PropertyUserCandidateOutcome.Unavailable
    };

    private static InvalidOperationException CandidateUnavailableException() =>
        new("عملیات قابل انجام نیست.");

    private static string MaskName(User user)
    {
        static string MaskPart(string value)
        {
            var trimmed = value.Trim();
            return trimmed.Length == 0 ? string.Empty : $"{trimmed[0]}***";
        }

        return $"{MaskPart(user.FirstName)} {MaskPart(user.LastName)}".Trim();
    }

'@
$serviceText = Replace-Between $serviceText $oldResolveStart $needsPasswordStart $candidateHelpers

Write-Source $servicePath $serviceText
