using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class SetPropertyAmenitiesRequest
{
    [Required]
    public IReadOnlyCollection<int> AmenityIds { get; set; } = [];
}

public class PropertyAmenityResponse
{
    public int AmenityId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int AmenityCategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
}
