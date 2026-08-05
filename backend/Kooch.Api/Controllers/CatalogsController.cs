using Kooch.Api.Catalogs;
using Kooch.Api.Dtos.Catalogs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/catalogs")]
public sealed class CatalogsController : ControllerBase
{
    [HttpGet("room-kinds")]
    [ProducesResponseType<IReadOnlyList<RoomKindCatalogResponse>>(StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<RoomKindCatalogResponse>> GetRoomKinds() =>
        Ok(RoomKindCatalog.Entries
            .OrderBy(entry => entry.DisplayOrder)
            .Select(entry => new RoomKindCatalogResponse(
                (int)entry.Value,
                entry.Code,
                entry.TitleFa,
                entry.TitleEn,
                entry.DisplayOrder))
            .ToArray());
}
