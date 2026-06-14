namespace Kooch.Api.Dtos.Properties;

public class PropertyCompletionResponse
{
    public int PropertyId { get; set; }
    public int CompletionPercentage { get; set; }
    public IReadOnlyList<string> CompletedSections { get; set; } = [];
    public IReadOnlyList<string> MissingSections { get; set; } = [];
}
