using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Admin;

public class AdminPropertyStatusRequest
{
    [Required]
    public PropertyStatus Status { get; set; }
}
