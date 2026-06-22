using Microsoft.AspNetCore.Http;

namespace Kooch.Api.Dtos.Properties;

public class PropertyImageUploadRequest
{
    public List<IFormFile> Files { get; set; } = [];
    public string? Tag { get; set; }
    public string? Caption { get; set; }
    public string? AltText { get; set; }
    public bool IsCover { get; set; }
    public int? RoomTypeId { get; set; }
    public int? ReplaceImageId { get; set; }
}
