using System.Text.Json.Serialization;

namespace Kooch.Api.Dtos.PropertyUsers;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public class PermissionActionsDto
{
    public bool View { get; set; }
    public bool Create { get; set; }
    public bool Edit { get; set; }
    public bool Delete { get; set; }
    public bool Export { get; set; }
}

public class PermissionMatrixDto : Dictionary<string, PermissionActionsDto>
{
}
