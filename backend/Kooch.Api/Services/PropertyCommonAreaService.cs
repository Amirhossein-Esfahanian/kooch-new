using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyCommonAreaService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyCommonAreaService
{
    public async Task<IReadOnlyList<PropertyCommonAreaResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, false, cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyCommonAreaResponse>> ReplaceAsync(
        int userId, UserRole role, int propertyId, ReplacePropertyCommonAreasRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        var existing = await dbContext.PropertyCommonAreas
            .Where(area => area.PropertyId == propertyId)
            .ToListAsync(cancellationToken);
        dbContext.PropertyCommonAreas.RemoveRange(existing);

        var areas = request.CommonAreas
            .Where(area => !string.IsNullOrWhiteSpace(area.Name))
            .Select((area, index) => new PropertyCommonArea
            {
                PropertyId = propertyId,
                Name = area.Name.Trim(),
                Description = Clean(area.Description),
                SortOrder = area.SortOrder == 0 ? index : area.SortOrder
            })
            .ToList();
        dbContext.PropertyCommonAreas.AddRange(areas);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    private Task<List<PropertyCommonAreaResponse>> LoadAsync(int propertyId, CancellationToken cancellationToken) =>
        dbContext.PropertyCommonAreas.AsNoTracking()
            .Where(area => area.PropertyId == propertyId)
            .OrderBy(area => area.SortOrder)
            .ThenBy(area => area.Name)
            .Select(area => new PropertyCommonAreaResponse
            {
                Id = area.Id,
                PropertyId = area.PropertyId,
                Name = area.Name,
                Description = area.Description,
                SortOrder = area.SortOrder
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
            throw new UnauthorizedAccessException("You cannot access this property's common areas.");
        }
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
