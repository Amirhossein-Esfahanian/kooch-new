using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kooch.Api.Integrations.PnlDev;

internal sealed class PnlDevCalendarResponseDto
{
    [JsonPropertyName("status")]
    public bool? Status { get; init; }

    [JsonPropertyName("result")]
    public JsonElement? Result { get; init; }
}

internal sealed class PnlDevCalendarDayDto
{
    [JsonPropertyName("solar")]
    public PnlDevDateDto? Solar { get; init; }

    [JsonPropertyName("moon")]
    public PnlDevDateDto? Moon { get; init; }

    [JsonPropertyName("gregorian")]
    public PnlDevDateDto? Gregorian { get; init; }

    [JsonPropertyName("holiday")]
    public bool? Holiday { get; init; }

    [JsonPropertyName("event")]
    public string[]? Events { get; init; }
}

internal sealed class PnlDevDateDto
{
    [JsonPropertyName("day")]
    public int? Day { get; init; }

    [JsonPropertyName("month")]
    public int? Month { get; init; }

    [JsonPropertyName("year")]
    public int? Year { get; init; }

    [JsonPropertyName("dayWeek")]
    public string? DayOfWeek { get; init; }
}
