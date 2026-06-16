using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyCompletionService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyCompletionService
{
    public async Task<PropertyCompletionResponse> GetAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        if (!await dbContext.Properties.AsNoTracking().AnyAsync(property => property.Id == propertyId, cancellationToken))
        {
            throw new KeyNotFoundException("Property not found.");
        }

        if (!await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        var state = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Id == propertyId)
            .Select(property => new
{
    Basic = property.Name != "" && property.Address != "" && property.City != "" && property.Description != "",
    Building = property.TotalAreaM2 != null &&
               property.FloorsCount != null,
    Images = property.Images.Any(),
    RoomTypes = property.RoomTypes.Any(),
    Amenities = property.PropertyAmenities.Any(),
    Descriptions = property.DescriptionSections
        .Any(section => section.SectionType == PropertyDescriptionSectionType.PropertyIntroduction && section.Content != ""),
    NearbyPlaces = property.NearbyPlaces.Any(place => place.IsActive)
})
            .SingleAsync(cancellationToken);

        var sections = new Dictionary<string, bool>
        {
            ["basic info"] = state.Basic,
            ["building info"] = state.Building,
            ["room types"] = state.RoomTypes,
            ["images"] = state.Images,
            ["amenities"] = state.Amenities,
            ["descriptions"] = state.Descriptions,
            ["nearby places"] = state.NearbyPlaces
        };

        var completedSections = sections.Where(section => section.Value).Select(section => section.Key).ToArray();
        var missingSections = sections.Where(section => !section.Value).Select(section => section.Key).ToArray();

        return new PropertyCompletionResponse
        {
            PropertyId = propertyId,
            CompletionPercentage = (int)Math.Round(completedSections.Length / 7m * 100m, MidpointRounding.AwayFromZero),
            CompletedSections = completedSections,
            MissingSections = missingSections
        };
    }
}
