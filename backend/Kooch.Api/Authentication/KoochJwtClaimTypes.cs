using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Authentication;

public static class KoochJwtClaimTypes
{
    public const string SessionVersion = "kooch:session_version";
}

public static class UserSessionVersionValidator
{
    public const string RevokedFailureMessage = "session_revoked";

    public static Task<bool> IsValidAsync(
        KoochDbContext dbContext,
        int userId,
        int sessionVersion,
        CancellationToken cancellationToken = default) =>
        dbContext.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user =>
                user.Id == userId &&
                !user.IsDeleted &&
                user.IsActive &&
                user.SecurityStampVersion == sessionVersion,
                cancellationToken);
}
