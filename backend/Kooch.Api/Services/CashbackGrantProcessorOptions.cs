namespace Kooch.Api.Services;

public sealed class CashbackGrantProcessorOptions
{
    public const string SectionName = "CashbackGrantProcessor";
    public bool Enabled { get; set; } = true;
    public int IntervalMinutes { get; set; } = 5;
    public int BatchSize { get; set; } = 100;
}
