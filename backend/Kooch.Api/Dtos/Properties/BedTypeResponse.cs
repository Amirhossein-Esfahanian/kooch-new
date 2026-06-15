namespace Kooch.Api.Dtos.Properties;

public class BedTypeResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
}

public class RoomTypeBedRequest
{
    public int BedTypeId { get; set; }
    public int Quantity { get; set; }
}

public class RoomTypeBedResponse
{
    public int BedTypeId { get; set; }
    public string BedTypeName { get; set; } = string.Empty;
    public string BedTypeSlug { get; set; } = string.Empty;
    public int Quantity { get; set; }
}
