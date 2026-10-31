using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Guests;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Kooch.Api.Controllers;

[ApiController]
[OwnerAuthorize]
[OwnerGuestApiDisabled]
[Route("api/owner/properties/{propertyId:int}/guests")]
public class OwnerGuestsController : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<IReadOnlyList<GuestResponse>> Search(
        int propertyId,
        [FromQuery] GuestSearchRequest query,
        CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status403Forbidden);
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<GuestResponse> GetById(
        int propertyId,
        int id,
        CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status403Forbidden);
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<GuestResponse> Create(
        int propertyId,
        GuestCreateRequest request,
        CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status403Forbidden);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<GuestResponse> Update(
        int propertyId,
        int id,
        GuestUpdateRequest request,
        CancellationToken cancellationToken)
    {
        return StatusCode(StatusCodes.Status403Forbidden);
    }
}

// Temporary containment until Property-scoped Guest management has an approved model.
// Short-circuit before model binding, including malformed create/update requests.
[AttributeUsage(AttributeTargets.Class)]
internal sealed class OwnerGuestApiDisabledAttribute : Attribute, IResourceFilter
{
    public void OnResourceExecuting(ResourceExecutingContext context) =>
        context.Result = new StatusCodeResult(StatusCodes.Status403Forbidden);

    public void OnResourceExecuted(ResourceExecutedContext context) { }
}
