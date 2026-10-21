using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PropertyVisitService(KoochDbContext dbContext, TimeProvider clock)
{
    public async Task RecordAsync(
        string slug,
        string sessionId,
        ClaimsPrincipal visitor,
        string? userAgent,
        CancellationToken cancellationToken = default)
    {
        var validatedSessionId = ValidateSessionId(sessionId);
        var normalizedSlug = EnglishSlugGenerator.NormalizeLookup(slug);
        var property = await dbContext.Properties.AsNoTracking()
            .Where(item => item.Slug == normalizedSlug && item.Status == PropertyStatus.Approved)
            .Select(item => new { item.Id, item.OwnerId })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Public property not found.");

        if (IsKnownBot(userAgent) || await IsManagementViewAsync(property.Id, property.OwnerId, visitor, cancellationToken))
            return;

        var now = clock.GetUtcNow();
        var businessDate = DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(now, IranSiteTime.BusinessTimeZone).DateTime);
        var hashInput = $"{property.Id}:{businessDate:yyyy-MM-dd}:{validatedSessionId}";
        var sessionHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(hashInput)));
        var visit = new PropertyVisit
        {
            PropertyId = property.Id,
            BusinessDate = businessDate,
            SessionHash = sessionHash,
            OccurredAtUtc = now.UtcDateTime
        };
        dbContext.PropertyVisits.Add(visit);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            dbContext.Entry(visit).State = EntityState.Detached;
            if (!await dbContext.PropertyVisits.AsNoTracking().AnyAsync(item =>
                    item.PropertyId == property.Id && item.BusinessDate == businessDate &&
                    item.SessionHash == sessionHash, cancellationToken))
                throw;
        }
    }

    private static string ValidateSessionId(string? sessionId)
    {
        if (sessionId is null || sessionId.Length is < 32 or > 128 ||
            sessionId.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_')))
            throw new ArgumentException("A valid opaque browser-session identifier is required.", nameof(sessionId));

        return sessionId;
    }

    private static bool IsKnownBot(string? userAgent)
    {
        if (string.IsNullOrEmpty(userAgent)) return false;
        return new[] { "bot", "crawler", "spider", "slurp", "headless", "preview", "facebookexternalhit" }
            .Any(marker => userAgent.Contains(marker, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<bool> IsManagementViewAsync(
        int propertyId, int ownerId, ClaimsPrincipal visitor, CancellationToken cancellationToken)
    {
        if (visitor.Identity?.IsAuthenticated != true ||
            !int.TryParse(visitor.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return false;

        var user = await dbContext.Users.AsNoTracking()
            .Where(item => item.Id == userId && item.IsActive)
            .Select(item => new { item.Role })
            .SingleOrDefaultAsync(cancellationToken);
        if (user is null) return false;
        if (user.Role is UserRole.SuperAdmin or UserRole.AdminAssistant || userId == ownerId)
            return true;

        return await dbContext.UserPropertyAccesses.AsNoTracking().AnyAsync(access =>
            access.UserId == userId && access.PropertyId == propertyId && access.IsActive &&
            access.Status == PropertyUserStatus.Active, cancellationToken);
    }
}
