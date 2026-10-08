using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/meal-plans")]
public sealed class MealPlansController(IRatePlanService ratePlanService) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<MealPlanOptionResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<MealPlanOptionResponse>>> Get(
        CancellationToken cancellationToken) =>
        Ok(await ratePlanService.ListReferenceMealPlansAsync(cancellationToken));
}
