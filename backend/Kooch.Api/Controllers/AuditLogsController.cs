using Kooch.Api.Authentication;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[PermissionAuthorize(PermissionKey.ViewReports)]
[Route("api/owner/properties/{propertyId:int}/audit-logs")]
public class AuditLogsController(IAuditLogService auditLogService) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<AuditLogResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AuditLogResponse>>> Get(
        int propertyId,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await auditLogService.GetByPropertyAsync(
            user.UserId,
            user.Role,
            propertyId,
            cancellationToken));
    }
}
