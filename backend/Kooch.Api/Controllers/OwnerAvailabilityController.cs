using System.Globalization;
using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Availability;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[Route("api/owner")]
public class OwnerAvailabilityController(IAvailabilityService availabilityService)
    : AuthenticatedControllerBase
{
    [HttpGet("properties/{propertyId:int}/inventory")]
    [ProducesResponseType<PropertyInventoryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyInventoryResponse>> GetPropertyInventory(
        int propertyId,
        [FromQuery] string? month,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken cancellationToken)
    {
        DateOnly startDate;
        DateOnly endDate;
        if (from.HasValue && to.HasValue)
        {
            startDate = from.Value;
            endDate = to.Value;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(month) ||
                !DateOnly.TryParseExact(
                    $"{month}-01",
                    "yyyy-MM-dd",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var monthDate))
            {
                return BadRequest(new { message = "Use from/to dates or month in YYYY-MM format." });
            }

            startDate = new DateOnly(monthDate.Year, monthDate.Month, 1);
            endDate = startDate.AddMonths(1).AddDays(-1);
        }

        var user = GetCurrentUser();
        return Ok(await availabilityService.GetPropertyInventoryAsync(
            user.UserId, user.Role, propertyId, startDate, endDate, cancellationToken));
    }

    [HttpPost("properties/{propertyId:int}/inventory/bulk")]
    [ProducesResponseType<PropertyInventoryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyInventoryResponse>> BulkUpdateInventory(
        int propertyId,
        BulkInventoryRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.BulkUpdateInventoryAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpPost("properties/{propertyId:int}/inventory/bulk-cells")]
    [ProducesResponseType<IReadOnlyList<InventoryDayResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<InventoryDayResponse>>> BulkUpdateInventoryCells(
        int propertyId,
        BulkInventoryCellsRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.BulkUpdateInventoryCellsAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpPost("properties/{propertyId:int}/inventory/cell")]
    [ProducesResponseType<InventoryDayResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<InventoryDayResponse>> UpsertInventoryDay(
        int propertyId,
        UpsertInventoryRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.UpsertInventoryDayAsync(
            user.UserId, user.Role, propertyId, request, cancellationToken));
    }

    [HttpPut("availability/{availabilityId:int}")]
    [ProducesResponseType<InventoryDayResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<InventoryDayResponse>> UpdateInventoryDay(
        int availabilityId,
        UpsertInventoryRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.UpdateInventoryDayAsync(
            user.UserId, user.Role, availabilityId, request.AvailableCount, cancellationToken));
    }

    [HttpGet("room-types/{roomTypeId:int}/availability")]
    [ProducesResponseType<IReadOnlyList<AvailabilityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AvailabilityResponse>>> Get(
        int roomTypeId,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.GetAsync(
            user.UserId, user.Role, roomTypeId, from, to, cancellationToken));
    }

    [HttpPost("room-types/{roomTypeId:int}/availability")]
    [ProducesResponseType<IReadOnlyList<AvailabilityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AvailabilityResponse>>> Set(
        int roomTypeId,
        SetAvailabilityRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await availabilityService.SetAsync(
            user.UserId, user.Role, roomTypeId, request, cancellationToken));
    }
}
