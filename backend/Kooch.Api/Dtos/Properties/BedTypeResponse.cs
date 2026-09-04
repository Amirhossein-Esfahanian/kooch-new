using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class BedTypeResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Icon { get; set; }
}

public sealed class CreateBedTypeRequest
{
    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [Required, MaxLength(170)]
    public string Slug { get; set; } = string.Empty;

    [MaxLength(64)]
    public string? IconUploadToken { get; set; }

    public bool RemoveIcon { get; set; }
}

public sealed class UpdateBedTypeRequest
{
    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(64)]
    public string? IconUploadToken { get; set; }

    public bool RemoveIcon { get; set; }
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
