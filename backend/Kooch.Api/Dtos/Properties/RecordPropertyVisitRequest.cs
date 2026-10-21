using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.Properties;

public sealed class RecordPropertyVisitRequest
{
    [Required]
    public string SessionId { get; set; } = string.Empty;
}
