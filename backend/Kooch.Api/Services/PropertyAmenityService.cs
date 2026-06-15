using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyAmenityService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyAmenityService
{
    public async Task<IReadOnlyList<PropertyAmenityResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, false, cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyAmenityResponse>> AddAsync(
        int userId, UserRole role, int propertyId, SetPropertyAmenitiesRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        var amenityIds = await ValidateAmenityIdsAsync(request.AmenityIds, cancellationToken);
        await ApplyAsync(propertyId, amenityIds, false, userId, cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyAmenityResponse>> ReplaceAsync(
        int userId, UserRole role, int propertyId, SetPropertyAmenitiesRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        var amenityIds = await ValidateAmenityIdsAsync(request.AmenityIds, cancellationToken);
        await ApplyAsync(propertyId, amenityIds, true, userId, cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    private async Task ApplyAsync(
        int propertyId,
        HashSet<int> amenityIds,
        bool replace,
        int userId,
        CancellationToken cancellationToken)
    {
        var existing = await dbContext.PropertyAmenities.IgnoreQueryFilters()
            .Where(join => join.PropertyId == propertyId)
            .ToListAsync(cancellationToken);

        foreach (var join in existing)
        {
            if (amenityIds.Remove(join.AmenityId))
            {
                join.IsDeleted = false;
                join.DeletedAtUtc = null;
                join.DeletedByUserId = null;
            }
            else if (replace && !join.IsDeleted)
            {
                join.IsDeleted = true;
                join.DeletedAtUtc = DateTime.UtcNow;
                join.DeletedByUserId = userId;
            }
        }

        dbContext.PropertyAmenities.AddRange(amenityIds.Select(amenityId => new PropertyAmenity
        {
            PropertyId = propertyId,
            AmenityId = amenityId
        }));

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<HashSet<int>> ValidateAmenityIdsAsync(
        IReadOnlyCollection<int> requestedIds,
        CancellationToken cancellationToken)
    {
        var ids = requestedIds.Where(id => id > 0).ToHashSet();
        var validIds = await dbContext.Amenities.AsNoTracking()
            .Where(amenity => ids.Contains(amenity.Id) && amenity.Scope != AmenityScope.RoomType)
            .Select(amenity => amenity.Id)
            .ToHashSetAsync(cancellationToken);

        if (validIds.Count != ids.Count)
        {
            throw new ArgumentException("One or more amenities are invalid for a property.");
        }

        return validIds;
    }

    private Task<List<PropertyAmenityResponse>> LoadAsync(int propertyId, CancellationToken cancellationToken) =>
        dbContext.PropertyAmenities.AsNoTracking()
            .Where(join => join.PropertyId == propertyId)
            .OrderBy(join => join.Amenity.AmenityCategory.SortOrder)
            .ThenBy(join => join.Amenity.SortOrder)
            .Select(join => new PropertyAmenityResponse
            {
                AmenityId = join.AmenityId,
                Name = join.Amenity.Name,
                AmenityCategoryId = join.Amenity.AmenityCategoryId,
                CategoryName = join.Amenity.AmenityCategory.Name
            })
            .ToListAsync(cancellationToken);

    private async Task EnsureAccessAsync(
        int userId, UserRole role, int propertyId, bool manage, CancellationToken cancellationToken)
    {
        var allowed = manage
            ? await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken)
            : await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot access this property's amenities.");
        }
    }
}
