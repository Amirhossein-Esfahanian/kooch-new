using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/amenity-categories")]
public class AmenityCategoriesController(KoochDbContext dbContext) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<AmenityCategoryResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AmenityCategoryResponse>>> Get(
        CancellationToken cancellationToken)
    {
        var categories = await dbContext.AmenityCategories.AsNoTracking()
            .Where(category => category.IsActive)
            .OrderBy(category => category.SortOrder)
            .ThenBy(category => category.Name)
            .Select(category => new AmenityCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Slug = category.Slug,
                SortOrder = category.SortOrder,
                Icon = category.Icon,
                IsActive = category.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(categories);
    }
}
