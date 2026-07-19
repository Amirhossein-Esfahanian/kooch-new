using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/properties")]
public class AdminPropertiesController(
    IPropertyService propertyService,
    IPropertyCompletionService propertyCompletionService,
    IAdminPropertyOwnerAccountService ownerAccountService) : AuthenticatedControllerBase
{
    [HttpGet("owner-candidates")]
    [ProducesResponseType<IReadOnlyList<AdminPropertyOwnerAccountResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AdminPropertyOwnerAccountResponse>>> GetOwnerCandidates(
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await ownerAccountService.GetCandidatesAsync(user.UserId, user.Role, cancellationToken));
    }

    [HttpPost("owner-candidates")]
    [ProducesResponseType<AdminPropertyOwnerAccountResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AdminPropertyOwnerAccountResponse>> CreateOwnerCandidate(
        AdminPropertyOwnerAccountRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        var owner = await ownerAccountService.CreateAsync(user.UserId, user.Role, request, cancellationToken);
        return CreatedAtAction(nameof(GetOwnerCandidates), new { id = owner.Id }, owner);
    }

    [HttpPost]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<PropertyResponse>> Create(CreatePropertyRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        request.Status = PropertyStatus.Draft;
        var property = await propertyService.CreatePropertyAsync(user.UserId, user.Role, request, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = property.Id }, property);
    }

    [HttpGet]
    [ProducesResponseType<IReadOnlyList<PropertyResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PropertyResponse>>> Get(CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetAllForAdminAsync(user.UserId, user.Role, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Update(int id, AdminUpdatePropertyRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.UpdatePropertyForAdminAsync(user.UserId, user.Role, id, request, cancellationToken));
    }

    [HttpPut("{id:int}/sections/basic")]
    public Task<ActionResult<PropertyResponse>> UpdateBasic(int id, UpdatePropertyBasicSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateBasicSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/location")]
    public Task<ActionResult<PropertyResponse>> UpdateLocation(int id, UpdatePropertyLocationSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateLocationSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/building")]
    public Task<ActionResult<PropertyResponse>> UpdateBuilding(int id, UpdatePropertyBuildingSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateBuildingSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/rules")]
    public Task<ActionResult<PropertyResponse>> UpdateRules(int id, UpdatePropertyRulesSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateRulesSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/financial")]
    public Task<ActionResult<PropertyResponse>> UpdateFinancial(int id, UpdatePropertyFinancialSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateFinancialSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/description")]
    public Task<ActionResult<PropertyResponse>> UpdateDescription(int id, UpdatePropertyDescriptionSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateDescriptionSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/sections/seo")]
    public Task<ActionResult<PropertyResponse>> UpdateSeo(int id, UpdatePropertySeoSectionRequest request, CancellationToken cancellationToken) =>
        UpdateSection((userId, role) => propertyService.UpdateSeoSectionAsync(userId, role, id, request, cancellationToken));

    [HttpPut("{id:int}/status")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> SetStatus(int id, AdminPropertyStatusRequest request, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.SetPropertyStatusAsync(user.UserId, user.Role, id, request.Status, cancellationToken));
    }

    [HttpPost("{id:int}/transfer-ownership")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> TransferOwnership(
        int id,
        AdminTransferPropertyOwnershipRequest request,
        CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.TransferOwnershipAsync(user.UserId, user.Role, id, request, cancellationToken));
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> GetById(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.GetPropertyByIdAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpGet("{id:int}/completion")]
    [ProducesResponseType<PropertyCompletionResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyCompletionResponse>> GetCompletion(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyCompletionService.GetAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/approve")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Approve(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.ApprovePropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/reject")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Reject(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.RejectPropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }

    [HttpPut("{id:int}/suspend")]
    [ProducesResponseType<PropertyResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PropertyResponse>> Suspend(int id, CancellationToken cancellationToken)
    {
        var user = GetCurrentUser();
        return Ok(await propertyService.SuspendPropertyAsync(user.UserId, user.Role, id, cancellationToken));
    }

    private async Task<ActionResult<PropertyResponse>> UpdateSection(
        Func<int, UserRole, Task<PropertyResponse>> update)
    {
        var user = GetCurrentUser();
        return Ok(await update(user.UserId, user.Role));
    }
}
