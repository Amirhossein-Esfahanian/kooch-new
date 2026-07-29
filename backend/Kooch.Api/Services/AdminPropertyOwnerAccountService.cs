using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Users;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

namespace Kooch.Api.Services;

public class AdminPropertyOwnerAccountService(
    KoochDbContext dbContext,
    IPermissionService permissionService,
    IAuthService authService,
    IHostEnvironment appEnvironment) : IAdminPropertyOwnerAccountService
{
    public async Task<AdminPropertyOwnerCandidatePageResponse> SearchCandidatesAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerCandidateQuery query,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertiesAsync(currentUserId, currentRole, cancellationToken);

        var users = dbContext.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => !user.IsDeleted && user.IsActive);
        if (query.ExcludeUserId.HasValue)
        {
            users = users.Where(user => user.Id != query.ExcludeUserId.Value);
        }

        var search = query.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            users = users.Where(user =>
                user.FirstName.Contains(search) ||
                user.LastName.Contains(search) ||
                (user.PhoneNumber != null && user.PhoneNumber.Contains(search)) ||
                (user.Email != null && user.Email.Contains(search)));
        }

        var totalCount = await users.CountAsync(cancellationToken);
        var items = await ProjectCandidates(users
                .OrderBy(user => user.LastName)
                .ThenBy(user => user.FirstName)
                .ThenBy(user => user.Id)
                .Skip((query.Page - 1) * query.PageSize)
                .Take(query.PageSize))
            .ToListAsync(cancellationToken);
        return new AdminPropertyOwnerCandidatePageResponse
        {
            Items = items,
            TotalCount = totalCount,
            Page = query.Page,
            PageSize = query.PageSize,
            TotalPages = totalCount == 0
                ? 0
                : (int)Math.Ceiling(totalCount / (double)query.PageSize)
        };
    }

    public async Task<AdminPropertyOwnerAccountResponse> CreateAsync(
        int currentUserId,
        UserRole currentRole,
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureCanManagePropertiesAsync(currentUserId, currentRole, cancellationToken);

        var identity = CreateUserIdentity(request.FirstName, request.LastName, request.PhoneNumber, request.Email);
        var email = identity.Email;
        var mobile = identity.PhoneNumber;
        await EnsureUniqueIdentityAsync(email, mobile, cancellationToken);
        var hasPassword = !string.IsNullOrWhiteSpace(request.Password);
        if (hasPassword)
        {
            PasswordPolicy.Validate(request.Password!);
        }

        var user = new User
        {
            FirstName = identity.FirstName,
            LastName = identity.LastName,
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
        string? email,
        string mobile,
        CancellationToken cancellationToken)
    {
        if (email is not null && await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicateEmailMessage);
        }

        var mobileVariants = UserIdentityNormalization.BuildPhoneNumberVariants(mobile);
        if (await dbContext.Users.IgnoreQueryFilters()
                .AnyAsync(user => user.PhoneNumber != null && mobileVariants.Contains(user.PhoneNumber), cancellationToken))
        {
            throw new ArgumentException(UserIdentityNormalization.DuplicatePhoneNumberMessage);
        }

        if (await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest =>
                        (email != null && guest.NormalizedEmail == email) ||
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
            Email = user.Email ?? string.Empty,
            PhoneNumber = user.PhoneNumber,
            IsActive = user.IsActive,
            PasswordSetupRequired = user.PasswordSetupRequired
        });

    private static IQueryable<AdminPropertyOwnerCandidateResponse> ProjectCandidates(IQueryable<User> query) =>
        query.Select(user => new AdminPropertyOwnerCandidateResponse
        {
            Id = user.Id,
            FirstName = user.FirstName,
            LastName = user.LastName,
            FullName = (user.FirstName + " " + user.LastName).Trim(),
            PhoneNumber = user.PhoneNumber,
            Email = user.Email
        });

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

}
