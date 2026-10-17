using Kooch.Api.Authentication;
using Kooch.Api.Dtos.WelcomeGifts;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[PermissionAuthorize(PermissionKey.ManagePromotions)]
[Route("api/admin/welcome-gift-campaigns")]
public sealed class AdminWelcomeGiftCampaignsController(
    IWelcomeGiftCampaignService campaignService) : AuthenticatedControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WelcomeGiftCampaignResponse>>> List(
        CancellationToken cancellationToken) =>
        Ok(await campaignService.ListAsync(cancellationToken));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<WelcomeGiftCampaignResponse>> Get(
        int id, CancellationToken cancellationToken) =>
        Ok(await campaignService.GetAsync(id, cancellationToken));

    [HttpPost]
    public async Task<ActionResult<WelcomeGiftCampaignResponse>> Create(
        WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken)
    {
        var campaign = await campaignService.CreateAsync(GetCurrentUser().UserId, request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = campaign.Id }, campaign);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<WelcomeGiftCampaignResponse>> Update(
        int id, WelcomeGiftCampaignUpsertRequest request, CancellationToken cancellationToken) =>
        Ok(await campaignService.UpdateAsync(GetCurrentUser().UserId, id, request, cancellationToken));

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await campaignService.DeleteAsync(GetCurrentUser().UserId, id, cancellationToken);
        return NoContent();
    }
}
