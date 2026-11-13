using System.Text.Json.Serialization;
using Kooch.Api.Serialization;

namespace Kooch.Api.Dtos.WelcomeGifts;

public sealed record GuestWelcomeGiftResponse(
    string Title,
    decimal GrantedAmount,
    string Currency,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime GrantedAtUtc,
    [property: JsonConverter(typeof(UtcDateTimeJsonConverter))] DateTime ExpiresAtUtc);
