using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Settlements;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePayments)]
[Route("api/admin/settlements")]
public sealed class AdminSettlementsController(SettlementService service) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<SettlementListItemResponse>>> List(
        [FromQuery] SettlementListQuery query, CancellationToken cancellationToken) =>
        Ok(await service.ListAsync(query, cancellationToken));

    [HttpGet("payables")]
    public async Task<ActionResult<PagedResult<PropertyPayableResponse>>> Payables(
        [FromQuery] SettlementListQuery query, CancellationToken cancellationToken) =>
        Ok(await service.ListPayablesAsync(query, cancellationToken));

    [HttpGet("properties")]
    public async Task<ActionResult<PagedResult<SettlementPropertyOption>>> Properties(
        [FromQuery] SettlementListQuery query, CancellationToken cancellationToken) =>
        Ok(await service.ListPropertiesAsync(query, cancellationToken));

    [HttpPost]
    public async Task<ActionResult<SettlementResponse>> Create(CreateSettlementRequest request, CancellationToken cancellationToken)
    {
        var settlement = await service.CreateAsync(request.PropertyId, request.PayableEntryIds,
            request.AllowEarlySettlement, GetCurrentUser().UserId, cancellationToken);
        return Created($"/api/admin/settlements/{settlement.Id}", Project(settlement));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SettlementResponse>> Get(int id, CancellationToken cancellationToken) =>
        Ok(Project(await service.GetAsync(id, cancellationToken)));

    [HttpPost("{id:int}/paid")]
    public async Task<ActionResult<SettlementResponse>> MarkPaid(int id, CancellationToken cancellationToken) =>
        Ok(Project(await service.MarkPaidAsync(id, cancellationToken)));

    private SettlementResponse Project(Settlement settlement) => new(settlement.Id, settlement.PropertyId,
        settlement.TotalAmount, settlement.Currency, settlement.CreatedAtUtc, settlement.PaidAtUtc,
        settlement.IsEarlySettlement, settlement.GetStatus(service.BusinessDate),
        settlement.Items.OrderBy(item => item.FinancialEntryId)
            .Select(item => new SettlementItemResponse(item.FinancialEntryId, item.FinancialEntry.Amount,
                item.FinancialEntry.PayableDueDate!.Value, item.FinancialEntry.Reservation?.ReservationNumber)).ToList(),
        settlement.Property.Name);
}
