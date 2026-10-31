using Kooch.Api.Authentication;
using Kooch.Api.Dtos.AuditLogs;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ViewReports)]
[Route("api/admin/audit-logs")]
public sealed class AdminAuditLogsController(IAuditLogService auditLogs) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<AdminAuditLogResponse>>> Get(
        [FromQuery] AdminAuditLogQuery query, CancellationToken cancellationToken) =>
        Ok(await auditLogs.GetForAdminAsync(GetCurrentUser().UserId, query, cancellationToken));

    [HttpGet("filter-options/actors")]
    public async Task<ActionResult<IReadOnlyList<AdminAuditFilterOption>>> GetActorOptions(
        [FromQuery] AdminAuditFilterOptionQuery query, CancellationToken cancellationToken) =>
        Ok(await auditLogs.GetActorOptionsForAdminAsync(GetCurrentUser().UserId, query, cancellationToken));

    [HttpGet("filter-options/properties")]
    public async Task<ActionResult<IReadOnlyList<AdminAuditFilterOption>>> GetPropertyOptions(
        [FromQuery] AdminAuditFilterOptionQuery query, CancellationToken cancellationToken) =>
        Ok(await auditLogs.GetPropertyOptionsForAdminAsync(GetCurrentUser().UserId, query, cancellationToken));

    [HttpGet("{auditLogId:int}/price-changes")]
    public async Task<ActionResult<AdminPriceChangePage>> GetPriceChanges(int auditLogId,
        [FromQuery] AdminPriceChangeQuery query, CancellationToken cancellationToken) =>
        Ok(await auditLogs.GetPriceChangesForAdminAsync(GetCurrentUser().UserId, auditLogId, query, cancellationToken));
}
