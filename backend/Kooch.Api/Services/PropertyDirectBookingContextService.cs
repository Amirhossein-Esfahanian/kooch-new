using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services;

public sealed class PropertyDirectBookingContextService(
    KoochDbContext dbContext, IDataProtectionProvider protectionProvider,
    IOptions<PropertyDirectBookingContextOptions> options, TimeProvider timeProvider)
    : IPropertyDirectBookingContextService
{
    internal const string Purpose = "Kooch.Account.PropertyDirectBookingContext.v1";
    private const string InvalidContextMessage = "Property Direct booking context is invalid or expired.";

    public async Task<PropertyDirectBookingContextResponse> IssueAsync(int authenticatedClientId,
        PropertyDirectBookingContextRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (authenticatedClientId <= 0 || !await dbContext.Users.AsNoTracking()
                .AnyAsync(user => user.Id == authenticatedClientId && user.IsActive, cancellationToken))
        {
            throw new UnauthorizedAccessException("An active authenticated account is required.");
        }

        var key = RequireKey(request.IdempotencyKey);
        if (string.IsNullOrWhiteSpace(request.PropertySlug) || request.PropertySlug.Length > 200)
        {
            throw new ArgumentException("A valid Property slug is required.");
        }

        var slug = EnglishSlugGenerator.NormalizeLookup(request.PropertySlug);
        var propertyId = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Slug == slug && property.Status == PropertyStatus.Approved)
            .Select(property => (int?)property.Id).SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var protector = GetProtector();
        var issuedAt = timeProvider.GetUtcNow();
        var expiresAt = issuedAt.AddMinutes(options.Value.LifetimeMinutes);
        var payload = new ContextPayload(1, authenticatedClientId, propertyId,
            (int)CommissionType.PropertyReferralCode, HashKey(key), issuedAt, expiresAt);
        try
        {
            return new(propertyId, protector.Protect(JsonSerializer.Serialize(payload)), expiresAt);
        }
        catch (Exception exception) when (exception is CryptographicException or IOException or UnauthorizedAccessException)
        {
            throw new PropertyDirectBookingContextUnavailableException();
        }
    }

    public TrustedPropertyDirectBookingContext Validate(string token, int authenticatedClientId,
        int expectedPropertyId, string normalizedIdempotencyKey) =>
        ValidateCore(token, authenticatedClientId, expectedPropertyId, normalizedIdempotencyKey, allowExpired: false);

    public TrustedPropertyDirectBookingContext ValidateForExistingSessionReplay(string token, int authenticatedClientId,
        int expectedPropertyId, string normalizedIdempotencyKey) =>
        ValidateCore(token, authenticatedClientId, expectedPropertyId, normalizedIdempotencyKey, allowExpired: true);

    private TrustedPropertyDirectBookingContext ValidateCore(string token, int authenticatedClientId,
        int expectedPropertyId, string normalizedIdempotencyKey, bool allowExpired)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096 || authenticatedClientId <= 0 || expectedPropertyId <= 0)
        {
            throw InvalidContext();
        }

        string key;
        try { key = RequireKey(normalizedIdempotencyKey); }
        catch (ArgumentException) { throw InvalidContext(); }
        var protector = GetProtector();
        ContextPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<ContextPayload>(protector.Unprotect(token));
        }
        catch (Exception exception) when (exception is CryptographicException or JsonException or FormatException)
        {
            throw InvalidContext();
        }

        var now = timeProvider.GetUtcNow();
        if (payload is null || payload.Version != 1 || payload.ClientId != authenticatedClientId ||
            payload.PropertyId != expectedPropertyId || payload.Policy != (int)CommissionType.PropertyReferralCode ||
            payload.IssuedAtUtc == default || payload.IssuedAtUtc.Offset != TimeSpan.Zero ||
            payload.ExpiresAtUtc.Offset != TimeSpan.Zero || payload.IssuedAtUtc > now ||
            (!allowExpired && payload.ExpiresAtUtc <= now) || payload.ExpiresAtUtc <= payload.IssuedAtUtc ||
            payload.ExpiresAtUtc - payload.IssuedAtUtc > TimeSpan.FromMinutes(60) ||
            payload.IdempotencyKeyHash is not { Length: 32 } ||
            !CryptographicOperations.FixedTimeEquals(payload.IdempotencyKeyHash, HashKey(key)))
        {
            throw InvalidContext();
        }

        return new(payload.ClientId, payload.PropertyId, CommissionType.PropertyReferralCode,
            payload.IssuedAtUtc, payload.ExpiresAtUtc);
    }

    private IDataProtector GetProtector()
    {
        try
        {
            if (!options.Value.HasPersistentKeyRing)
            {
                throw new PropertyDirectBookingContextUnavailableException();
            }
            return protectionProvider.CreateProtector(Purpose);
        }
        catch (OptionsValidationException)
        {
            throw new PropertyDirectBookingContextUnavailableException();
        }
    }

    private static string RequireKey(string? value)
    {
        var normalized = BookingSessionService.NormalizeIdempotencyKey(value);
        if (normalized is null || normalized.Length > 200)
        {
            throw new ArgumentException("A non-empty idempotency key of at most 200 characters is required.");
        }
        return normalized;
    }

    private static byte[] HashKey(string key) => SHA256.HashData(Encoding.UTF8.GetBytes(key));
    private static ArgumentException InvalidContext() => new(InvalidContextMessage);

    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    internal sealed record ContextPayload(int Version, int ClientId, int PropertyId, int Policy,
        byte[] IdempotencyKeyHash, DateTimeOffset IssuedAtUtc, DateTimeOffset ExpiresAtUtc);
}
