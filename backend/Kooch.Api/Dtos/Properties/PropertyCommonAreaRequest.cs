using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class PropertyCommonAreaRequest
{
    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Description { get; set; }

    public int SortOrder { get; set; }
}

public class ReplacePropertyCommonAreasRequest
{
    public IReadOnlyList<PropertyCommonAreaRequest> CommonAreas { get; set; } = [];
}

public class PropertyCommonAreaResponse
{
    public int Id { get; set; }
    public int PropertyId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
}
