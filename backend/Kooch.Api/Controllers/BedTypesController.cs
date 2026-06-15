using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/bed-types")]
public class BedTypesController(KoochDbContext dbContext) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<BedTypeResponse>>> Get(CancellationToken cancellationToken)
    {
        return Ok(await dbContext.BedTypes.AsNoTracking()
            .OrderBy(bedType => bedType.Name)
            .Select(bedType => new BedTypeResponse
            {
                Id = bedType.Id,
                Name = bedType.Name,
                Slug = bedType.Slug
            })
            .ToListAsync(cancellationToken));
    }
}
