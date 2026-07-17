using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace Kooch.Api.Services;

public class AdminPropertyOwnerAccountService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IAuthService authService,
    IHostEnvironment appEnvironment) : IAdminPropertyOwnerAccountService
{
    public async Task<IReadOnlyList<AdminPropertyOwnerAccountResponse>> GetCandidatesAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertiesAsync(currentUserId, currentRole, cancellationToken);

        return await Project(dbContext.Users.AsNoTracking()
                .Where(user => user.Role == UserRole.Client)
                .OrderBy(user => user.LastName)
                .ThenBy(user => user.FirstName))
            .ToListAsync(cancellationToken);
    }

    public async Task<AdminPropertyOwnerAccountResponse> CreateAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertiesAsync(currentUserId, currentRole, cancellationToken);

        var email = NormalizeEmail(request.Email);
        var mobile = NormalizeMobile(request.PhoneNumber);
        await EnsureUniqueIdentityAsync(email, mobile, cancellationToken);
        var hasPassword = !string.IsNullOrWhiteSpace(request.Password);
        if (hasPassword)
        {
            PasswordPolicy.Validate(request.Password!);
        }

        var user = new User
        {
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            PhoneNumber = mobile,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(hasPassword ? request.Password! : Guid.NewGuid().ToString("N")),
            Role = UserRole.Client,
            ParentUserId = currentUserId,
            IsActive = hasPassword,
            PasswordSetupRequired = !hasPassword
        };

        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(cancellationToken);

        var response = await Project(dbContext.Users.AsNoTracking().Where(item => item.Id == user.Id))
            .SingleAsync(cancellationToken);
        if (!hasPassword)
        {
            var setupLink = await authService.CreatePasswordSetupTokenAsync(user.Id, cancellationToken);
            if (appEnvironment.IsDevelopment())
            {
                response.TemporarySetupLink = setupLink;
            }
        }

        return response;
    }

    private async Task EnsureCanManagePropertiesAsync(
        int currentUserId,
        UserRole currentRole,
        CancellationToken cancellationToken)
    {
        var allowed = currentRole == UserRole.SuperAdmin ||
                      currentRole == UserRole.AdminAssistant &&
                      await permissionService.HasPermissionAsync(
                          currentUserId,
                          PermissionKey.ManageProperties,
                          null,
                          cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("ManageProperties permission is required.");
        }
    }

    private async Task EnsureUniqueIdentityAsync(
        string email,
        string? mobile,
        CancellationToken cancellationToken)
    {
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw new ArgumentException("Email is already in use.");
        }

        if (string.IsNullOrWhiteSpace(mobile))
        {
            if (await dbContext.Guests.AsNoTracking()
                    .AnyAsync(guest => guest.NormalizedEmail == email, cancellationToken))
            {
                throw new ArgumentException("Guest with this email already exists.");
            }

            return;
        }

        var mobileVariants = BuildMobileVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.PhoneNumber != null && mobileVariants.Contains(user.PhoneNumber), cancellationToken))
        {
            throw new ArgumentException("Phone number is already in use.");
        }

        if (await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest =>
                        guest.NormalizedEmail == email ||
                        guest.NormalizedMobile == mobile,
                    cancellationToken))
        {
            throw new ArgumentException("Guest with this mobile or email already exists.");
        }
    }

    private static IQueryable<AdminPropertyOwnerAccountResponse> Project(IQueryable<User> query) =>
        query.Select(user => new AdminPropertyOwnerAccountResponse
        {
            Id = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            FullName = (user.FirstName + " " + user.LastName).Trim(),
            Email = user.Email,
            PhoneNumber = user.PhoneNumber,
            IsActive = user.IsActive,
            PasswordSetupRequired = user.PasswordSetupRequired
        });

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static string? NormalizeMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;

        var builder = new System.Text.StringBuilder();
        foreach (var character in mobile.Trim())
        {
            var normalized = character switch
            {
                >= '\u06F0' and <= '\u06F9' => (char)('0' + character - '\u06F0'),
                >= '\u0660' and <= '\u0669' => (char)('0' + character - '\u0660'),
                _ => character
            };
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

        return string.IsNullOrWhiteSpace(value) ? null : value;
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
}
