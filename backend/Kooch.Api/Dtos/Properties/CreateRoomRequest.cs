using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public class CreateRoomRequest
{
    [Required, MaxLength(100)]
    public string Name { get; set; } = string.Empty;
}
