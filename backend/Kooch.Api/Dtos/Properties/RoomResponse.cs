namespace Kooch.Api.Dtos.Properties;

public class RoomResponse
{
    public int Id { get; set; }
    public int RoomTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; }
}
