namespace Kooch.Api.Dtos.Properties;

public enum PropertyCompletionSectionStatus
{
    Complete,
    Incomplete,
    NotStarted
}

public enum PropertyHealthStatus
{
    Ready,
    NeedsAttention,
    Incomplete
}

public class PropertyCompletionSectionResponse
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public PropertyCompletionSectionStatus Status { get; set; }
    public IReadOnlyList<string> MissingItems { get; set; } = [];
    public string ActionTarget { get; set; } = string.Empty;
}

public class PropertyCompletionResponse
{
    public int PropertyId { get; set; }
    public int CompletionPercentage { get; set; }
    public PropertyHealthStatus HealthStatus { get; set; }
    public IReadOnlyList<PropertyCompletionSectionResponse> Sections { get; set; } = [];
    public IReadOnlyList<string> Warnings { get; set; } = [];
    public IReadOnlyList<string> CompletedSections { get; set; } = [];
    public IReadOnlyList<string> MissingSections { get; set; } = [];
    public bool CanActivate { get; set; }
}
