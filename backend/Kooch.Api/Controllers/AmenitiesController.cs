using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Authentication;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/amenities")]
public class AmenitiesController(KoochDbContext dbContext) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
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

    [HttpPost]
    [OwnerAuthorize]
    [ProducesResponseType<AmenityResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AmenityResponse>> Create(
        AmenityRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCategoryAsync(request.AmenityCategoryId, cancellationToken);
        var slug = await CreateUniqueSlugAsync(request.Slug, request.Name, null, cancellationToken);
        var amenity = new Amenity
        {
            AmenityCategoryId = request.AmenityCategoryId,
            Name = request.Name.Trim(),
            Slug = slug,
            Description = Clean(request.Description),
            Icon = Clean(request.Icon),
            Scope = request.Scope,
            SortOrder = request.SortOrder
        };
        dbContext.Amenities.Add(amenity);
        await dbContext.SaveChangesAsync(cancellationToken);
        return StatusCode(StatusCodes.Status201Created, await LoadAsync(amenity.Id, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [OwnerAuthorize]
    [ProducesResponseType<AmenityResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AmenityResponse>> Update(
        int id,
        AmenityRequest request,
        CancellationToken cancellationToken)
    {
        var amenity = await dbContext.Amenities
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity not found.");

        await EnsureCategoryAsync(request.AmenityCategoryId, cancellationToken);
        amenity.AmenityCategoryId = request.AmenityCategoryId;
        amenity.Name = request.Name.Trim();
        amenity.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
        amenity.Description = Clean(request.Description);
        amenity.Icon = Clean(request.Icon);
        amenity.Scope = request.Scope;
        amenity.SortOrder = request.SortOrder;

        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(await LoadAsync(amenity.Id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    [OwnerAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var amenity = await dbContext.Amenities
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity not found.");
        amenity.IsDeleted = true;
        amenity.DeletedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private async Task EnsureCategoryAsync(int categoryId, CancellationToken cancellationToken)
    {
        if (!await dbContext.AmenityCategories.AsNoTracking()
                .AnyAsync(category => category.Id == categoryId && category.IsActive, cancellationToken))
        {
            throw new ArgumentException("Amenity category not found.");
        }
    }

    private async Task<string> CreateUniqueSlugAsync(
        string? requestedSlug,
        string name,
        int? amenityId,
        CancellationToken cancellationToken)
    {
        var slug = EnglishSlugGenerator.Create(Clean(requestedSlug) ?? name, "amenity");
        if (await dbContext.Amenities.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(amenity => amenity.Slug == slug && amenity.Id != amenityId, cancellationToken))
        {
            throw new InvalidOperationException("An amenity with this slug already exists.");
        }

        return slug;
    }

    private Task<AmenityResponse> LoadAsync(int id, CancellationToken cancellationToken) =>
        dbContext.Amenities.AsNoTracking()
            .Where(amenity => amenity.Id == id)
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
            .SingleAsync(cancellationToken);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
