using System.Text.Json.Serialization;
using Kooch.Api.Entities;
using Kooch.Api.Serialization;

namespace Kooch.Api.Dtos.Reservations;

public sealed record GuestReservationCashbackResponse(GuestCashbackSummaryResponse? Cashback);

public sealed class GuestCashbackSummaryResponse
{
    public CashbackEntitlementStatus Status { get; init; }
    public decimal Amount { get; init; }
    public string Currency { get; init; } = string.Empty;
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime EligibleAtUtc { get; init; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? GrantedAtUtc { get; init; }
    [JsonConverter(typeof(UtcDateTimeJsonConverter))]
    public DateTime? ExpiresAtUtc { get; init; }
}
