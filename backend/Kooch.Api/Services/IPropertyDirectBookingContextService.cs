using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertyDirectBookingContextService
{
    Task<PropertyDirectBookingContextResponse> IssueAsync(int authenticatedClientId,
        PropertyDirectBookingContextRequest request, CancellationToken cancellationToken = default);

    TrustedPropertyDirectBookingContext Validate(string token, int authenticatedClientId,
        int expectedPropertyId, string normalizedIdempotencyKey);

    // Only after matching a persisted Direct session under the booking idempotency lock.
    TrustedPropertyDirectBookingContext ValidateForExistingSessionReplay(string token, int authenticatedClientId,
        int expectedPropertyId, string normalizedIdempotencyKey);
}

public sealed record TrustedPropertyDirectBookingContext(
    int ClientId, int PropertyId, CommissionType CommissionType,
    DateTimeOffset IssuedAtUtc, DateTimeOffset ExpiresAtUtc);

public sealed class PropertyDirectBookingContextUnavailableException() : Exception(
    "Property Direct booking contexts are temporarily unavailable.");
