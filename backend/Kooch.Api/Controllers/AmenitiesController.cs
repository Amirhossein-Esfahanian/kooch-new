using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/amenities")]
public class AmenitiesController(KoochDbContext dbContext) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<AmenityResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AmenityResponse>>> Get(
        CancellationToken cancellationToken)
    {
        var amenities = await dbContext.Amenities.AsNoTracking()
            .Where(amenity => amenity.AmenityCategory.IsActive)
            .OrderBy(amenity => amenity.AmenityCategory.SortOrder)
            .ThenBy(amenity => amenity.SortOrder)
            .ThenBy(amenity => amenity.Name)
            .Select(amenity => new AmenityResponse
            {
                Id = amenity.Id,
                AmenityCategoryId = amenity.AmenityCategoryId,
                CategoryName = amenity.AmenityCategory.Name,
                CategorySlug = amenity.AmenityCategory.Slug,
                CategorySortOrder = amenity.AmenityCategory.SortOrder,
                Name = amenity.Name,
                Slug = amenity.Slug,
                Description = amenity.Description,
                Icon = amenity.Icon,
                Scope = amenity.Scope,
                SortOrder = amenity.SortOrder
            })
            .ToListAsync(cancellationToken);

        return Ok(amenities);
    }
}
