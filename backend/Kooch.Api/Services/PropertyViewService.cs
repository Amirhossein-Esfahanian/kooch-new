using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyViewService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyViewService
{
    public async Task<IReadOnlyList<PropertyViewResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, false, cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    public async Task<IReadOnlyList<PropertyViewResponse>> ReplaceAsync(
        int userId, UserRole role, int propertyId, SetPropertyViewsRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        var existing = await dbContext.PropertyViews
            .Where(view => view.PropertyId == propertyId)
            .ToListAsync(cancellationToken);
        dbContext.PropertyViews.RemoveRange(existing);
        dbContext.PropertyViews.AddRange(request.Views.Distinct().Select(view => new PropertyView
        {
            PropertyId = propertyId,
            ViewType = view
        }));
        await dbContext.SaveChangesAsync(cancellationToken);
        return await LoadAsync(propertyId, cancellationToken);
    }

    private Task<List<PropertyViewResponse>> LoadAsync(int propertyId, CancellationToken cancellationToken) =>
        dbContext.PropertyViews.AsNoTracking()
            .Where(view => view.PropertyId == propertyId)
            .OrderBy(view => view.ViewType)
            .Select(view => new PropertyViewResponse { ViewType = view.ViewType })
            .ToListAsync(cancellationToken);

    private async Task EnsureAccessAsync(
        int userId, UserRole role, int propertyId, bool manage, CancellationToken cancellationToken)
    {
        var allowed = manage
            ? await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken)
            : await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot access this property's views.");
        }
    }
}
