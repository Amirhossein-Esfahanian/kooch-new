using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Availability;

public class SetAvailabilityRequest
{
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    [Range(0, double.MaxValue)]
    public decimal Price { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? OriginalPrice { get; set; }

    [Range(0, int.MaxValue)]
    public int AvailableCount { get; set; }

    public AvailabilityStatus Status { get; set; }

    [Range(1, int.MaxValue)]
    public int? MinNightsOverride { get; set; }
}
