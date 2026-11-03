using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.BookingSessions;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PropertyDirectBookingContextRequest
{
    [Required, MaxLength(200)]
    public string PropertySlug { get; set; } = string.Empty;

    [Required]
    public string IdempotencyKey { get; set; } = string.Empty;
}

public sealed record PropertyDirectBookingContextResponse(
    int PropertyId, string Token, DateTimeOffset ExpiresAtUtc);
