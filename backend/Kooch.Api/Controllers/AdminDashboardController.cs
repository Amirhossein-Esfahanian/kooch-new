using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[AdminAuthorize]
[Route("api/admin/dashboard")]
public class AdminDashboardController(KoochDbContext dbContext) : AuthenticatedControllerBase
{
    [HttpGet]
    [ProducesResponseType<AdminDashboardResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AdminDashboardResponse>> Get(CancellationToken cancellationToken)
    {
        var pendingItems = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Status == PropertyStatus.PendingReview)
            .OrderByDescending(property => property.CreatedAtUtc)
            .Take(8)
            .Select(property => new PropertyResponse
            {
                Id = property.Id,
                OwnerId = property.OwnerId,
                OwnerName = (property.Owner.FirstName + " " + property.Owner.LastName).Trim(),
                OwnerEmail = property.Owner.Email,
                CreatedAtUtc = property.CreatedAtUtc,
                DestinationId = property.DestinationId,
                DestinationName = property.Destination.Name,
                Name = property.Name,
                EnglishName = property.EnglishName,
                Slug = property.Slug,
                Description = property.Description,
                Address = property.Address,
                City = property.City,
                Country = property.Country,
                Status = property.Status,
                Type = property.Type,
                InventoryMode = property.InventoryMode,
                CheckInTime = property.CheckInTime,
                CheckOutTime = property.CheckOutTime,
                HasElevator = property.HasElevator,
                IsWheelchairAccessible = property.IsWheelchairAccessible,
                HasGroundFloorRoom = property.HasGroundFloorRoom,
                HasAccessibleBathroom = property.HasAccessibleBathroom
            })
            .ToListAsync(cancellationToken);

        return Ok(new AdminDashboardResponse
        {
            TotalProperties = await dbContext.Properties.CountAsync(cancellationToken),
            PendingProperties = await dbContext.Properties.CountAsync(property => property.Status == PropertyStatus.PendingReview, cancellationToken),
            ApprovedProperties = await dbContext.Properties.CountAsync(property => property.Status == PropertyStatus.Approved, cancellationToken),
            TotalUsers = await dbContext.Users.IgnoreQueryFilters().CountAsync(cancellationToken),
            TotalOwners = await dbContext.Users.IgnoreQueryFilters().CountAsync(user => user.Role == UserRole.Owner, cancellationToken),
            PendingPropertyItems = pendingItems
        });
    }
}
