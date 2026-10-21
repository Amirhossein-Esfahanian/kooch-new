namespace Kooch.Api.Entities;

public sealed class PropertyVisit
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public DateOnly BusinessDate { get; set; }
    public string SessionHash { get; set; } = string.Empty;
    public DateTime OccurredAtUtc { get; set; }

    public Property Property { get; set; } = null!;
}
