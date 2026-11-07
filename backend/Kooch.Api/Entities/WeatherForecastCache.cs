namespace Kooch.Api.Entities;

public class WeatherForecastCache : BaseEntity
{
    public string LocationKey { get; set; } = string.Empty;
    public string? NormalizedForecastJson { get; set; }
    public DateTime? FetchedAtUtc { get; set; }
    public string? LeaseOwner { get; set; }
    public DateTime? LeaseExpiresAtUtc { get; set; }
    public byte[] RowVersion { get; set; } = [];
}
