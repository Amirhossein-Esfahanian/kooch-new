using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Amenities;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Controllers;

[ApiController]
[Route("api/amenity-categories")]
public class AmenityCategoriesController(
    KoochDbContext dbContext,
    IWebHostEnvironment environment,
    IPermissionService permissionService) : AuthenticatedControllerBase
{
    private const long MaxSvgFileSizeBytes = 256 * 1024;

    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType<IReadOnlyList<AmenityCategoryResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<AmenityCategoryResponse>>> Get(
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        var query = dbContext.AmenityCategories.AsNoTracking()
            .Where(category => !category.IsDeleted);

        if (!includeInactive)
        {
            query = query.Where(category => category.IsActive);
        }

        var categories = await query
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

    [HttpPost]
    [AdminAuthorize]
    [ProducesResponseType<AmenityCategoryResponse>(StatusCodes.Status201Created)]
    public async Task<ActionResult<AmenityCategoryResponse>> Create(
        AmenityCategoryRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var slug = await CreateUniqueSlugAsync(request.Slug, request.Name, null, cancellationToken);
        var category = new AmenityCategory
        {
            Name = request.Name.Trim(),
            Slug = slug,
            SortOrder = request.SortOrder,
            Icon = Clean(request.Icon),
            IsActive = request.IsActive,
            CreatedAtUtc = DateTime.UtcNow
        };

        dbContext.AmenityCategories.Add(category);
        await dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, await LoadAsync(category.Id, cancellationToken));
    }

    [HttpPut("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType<AmenityCategoryResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AmenityCategoryResponse>> Update(
        int id,
        AmenityCategoryRequest request,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var category = await dbContext.AmenityCategories
            .SingleOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity category not found.");

        category.Name = request.Name.Trim();
        category.Slug = await CreateUniqueSlugAsync(request.Slug, request.Name, id, cancellationToken);
        category.SortOrder = request.SortOrder;
        category.Icon = Clean(request.Icon);
        category.IsActive = request.IsActive;
        category.UpdatedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(await LoadAsync(category.Id, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    [AdminAuthorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var category = await dbContext.AmenityCategories
            .Include(category => category.Amenities)
            .SingleOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken)
            ?? throw new KeyNotFoundException("Amenity category not found.");

        var hasActiveAmenities = category.Amenities.Any(amenity => !amenity.IsDeleted);
        if (hasActiveAmenities)
        {
            return Conflict(new { message = "این دسته‌بندی دارای امکانات مرتبط است و قابل حذف نیست." });
        }

        category.IsDeleted = true;
        category.IsActive = false;
        category.DeletedAtUtc = DateTime.UtcNow;
        category.UpdatedAtUtc = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("svg")]
    [AdminAuthorize]
    [Consumes("multipart/form-data")]
    [ProducesResponseType<AmenitySvgUploadResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AmenitySvgUploadResponse>> UploadSvg(
        [FromForm] IFormFile file,
        [FromForm] string slug,
        CancellationToken cancellationToken)
    {
        await EnsureCanManageAmenitiesAsync(cancellationToken);
        var safeSlug = EnglishSlugGenerator.Create(Clean(slug) ?? "amenity-category-icon", "amenity-category-icon");
        await ValidateSvgUploadAsync(file, cancellationToken);

        var uploadRoot = Path.Combine(
            environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"),
            "svgs",
            "amenity-categories");
        Directory.CreateDirectory(uploadRoot);

        var fileName = $"{safeSlug}.svg";
        var absolutePath = Path.Combine(uploadRoot, fileName);

        await using (var stream = System.IO.File.Create(absolutePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        return Ok(new AmenitySvgUploadResponse($"/svgs/amenity-categories/{fileName}"));
    }

    private async Task EnsureCanManageAmenitiesAsync(CancellationToken cancellationToken)
    {
        var (userId, _) = GetCurrentUser();
        if (!await permissionService.HasPermissionAsync(userId, PermissionKey.ManageAmenities, null, cancellationToken))
        {
            throw new UnauthorizedAccessException("ManageAmenities permission is required.");
        }
    }
    private async Task<AmenityCategoryResponse> LoadAsync(int id, CancellationToken cancellationToken) =>
        await dbContext.AmenityCategories.AsNoTracking()
            .Where(category => category.Id == id && !category.IsDeleted)
            .Select(category => new AmenityCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Slug = category.Slug,
                SortOrder = category.SortOrder,
                Icon = category.Icon,
                IsActive = category.IsActive
            })
            .SingleAsync(cancellationToken);

    private async Task<string> CreateUniqueSlugAsync(
        string? requestedSlug,
        string name,
        int? categoryId,
        CancellationToken cancellationToken)
    {
        var slug = EnglishSlugGenerator.Create(Clean(requestedSlug) ?? name, "amenity-category");
        if (await dbContext.AmenityCategories.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(category => category.Slug == slug && category.Id != categoryId, cancellationToken))
        {
            throw new InvalidOperationException("A category with this slug already exists.");
        }

        return slug;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task ValidateSvgUploadAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ArgumentException("Uploaded SVG file is empty.");
        }

        if (file.Length > MaxSvgFileSizeBytes)
        {
            throw new ArgumentException("SVG file must be 256KB or smaller.");
        }

        var extension = Path.GetExtension(file.FileName);
        if (!extension.Equals(".svg", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only SVG files are allowed.");
        }

        await using var stream = file.OpenReadStream();
        using var reader = new StreamReader(stream);
        var content = await reader.ReadToEndAsync(cancellationToken);
        var normalized = content.TrimStart('\uFEFF', ' ', '\t', '\r', '\n').ToLowerInvariant();
        if (!normalized.Contains("<svg", StringComparison.Ordinal) ||
            normalized.Contains("<script", StringComparison.Ordinal) ||
            normalized.Contains("javascript:", StringComparison.Ordinal) ||
            normalized.Contains("onload=", StringComparison.Ordinal) ||
            normalized.Contains("onerror=", StringComparison.Ordinal))
        {
            throw new ArgumentException("The uploaded file is not a safe SVG.");
        }
    }
}

