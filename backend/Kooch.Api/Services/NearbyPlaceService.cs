using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class NearbyPlaceService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : INearbyPlaceService
{
    public async Task<IReadOnlyList<NearbyPlaceResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, false, cancellationToken);
        return await dbContext.NearbyPlaces.AsNoTracking()
            .Where(place => place.PropertyId == propertyId)
            .OrderBy(place => place.Category)
            .ThenBy(place => place.Title)
            .Select(place => new NearbyPlaceResponse
            {
                Id = place.Id,
                PropertyId = place.PropertyId,
                Title = place.Title,
                Category = place.Category,
                DistanceInMeters = place.DistanceInMeters,
                WalkingMinutes = place.WalkingMinutes,
                DrivingMinutes = place.DrivingMinutes,
                Description = place.Description,
                Latitude = place.Latitude,
                Longitude = place.Longitude,
                IsDefault = place.IsDefault,
                IsCustom = place.IsCustom,
                IsActive = place.IsActive
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<NearbyPlaceResponse> CreateAsync(
        int userId, UserRole role, int propertyId, NearbyPlaceRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        var place = new NearbyPlace { PropertyId = propertyId };
        Apply(place, request);
        dbContext.NearbyPlaces.Add(place);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(place);
    }

    public async Task<NearbyPlaceResponse> UpdateAsync(
        int userId, UserRole role, int nearbyPlaceId, NearbyPlaceRequest request,
        CancellationToken cancellationToken = default)
    {
        var place = await dbContext.NearbyPlaces
            .SingleOrDefaultAsync(item => item.Id == nearbyPlaceId, cancellationToken)
            ?? throw new KeyNotFoundException("Nearby place not found.");
        await EnsureAccessAsync(userId, role, place.PropertyId, true, cancellationToken);
        Apply(place, request);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(place);
    }

    private async Task EnsureAccessAsync(
        int userId, UserRole role, int propertyId, bool manage, CancellationToken cancellationToken)
    {
        var allowed = manage
            ? await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken)
            : await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot access this property's nearby places.");
        }
    }

    private static void Apply(NearbyPlace place, NearbyPlaceRequest request)
    {
        place.Title = request.Title.Trim();
        place.Category = request.Category;
        place.DistanceInMeters = request.DistanceInMeters;
        place.WalkingMinutes = request.WalkingMinutes;
        place.DrivingMinutes = request.DrivingMinutes;
        place.Description = Clean(request.Description);
        place.Latitude = request.Latitude;
        place.Longitude = request.Longitude;
        place.IsDefault = request.IsDefault;
        place.IsCustom = request.IsCustom;
        place.IsActive = request.IsActive;
    }

    private static NearbyPlaceResponse Map(NearbyPlace place) => new()
    {
        Id = place.Id,
        PropertyId = place.PropertyId,
        Title = place.Title,
        Category = place.Category,
        DistanceInMeters = place.DistanceInMeters,
        WalkingMinutes = place.WalkingMinutes,
        DrivingMinutes = place.DrivingMinutes,
        Description = place.Description,
        Latitude = place.Latitude,
        Longitude = place.Longitude,
        IsDefault = place.IsDefault,
        IsCustom = place.IsCustom,
        IsActive = place.IsActive
    };

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
