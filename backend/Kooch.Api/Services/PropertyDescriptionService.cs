using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyDescriptionService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IPropertyDescriptionService
{
    public async Task<IReadOnlyList<PropertyDescriptionSectionResponse>> GetAsync(
        int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, false, cancellationToken);
        return await dbContext.PropertyDescriptionSections.AsNoTracking()
            .Where(section => section.PropertyId == propertyId)
            .OrderBy(section => section.SortOrder)
            .ThenBy(section => section.SectionType)
            .Select(section => new PropertyDescriptionSectionResponse
            {
                Id = section.Id,
                PropertyId = section.PropertyId,
                SectionType = section.SectionType,
                Title = section.Title,
                Content = section.Content,
                SortOrder = section.SortOrder
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<PropertyDescriptionSectionResponse> CreateAsync(
        int userId,
        UserRole role,
        int propertyId,
        PropertyDescriptionSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureAccessAsync(userId, role, propertyId, true, cancellationToken);
        if (await dbContext.PropertyDescriptionSections.AsNoTracking().AnyAsync(
                item => item.PropertyId == propertyId && item.SectionType == request.SectionType,
                cancellationToken))
        {
            throw new InvalidOperationException("A description with this section type already exists.");
        }

        var section = new PropertyDescriptionSection
        {
            PropertyId = propertyId,
            SectionType = request.SectionType,
            Title = request.Title.Trim(),
            Content = request.Content.Trim(),
            SortOrder = request.SortOrder
        };
        dbContext.PropertyDescriptionSections.Add(section);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(section);
    }

    public async Task<PropertyDescriptionSectionResponse> UpdateAsync(
        int userId,
        UserRole role,
        int descriptionId,
        PropertyDescriptionSectionRequest request,
        CancellationToken cancellationToken = default)
    {
        var section = await dbContext.PropertyDescriptionSections
            .SingleOrDefaultAsync(item => item.Id == descriptionId, cancellationToken)
            ?? throw new KeyNotFoundException("Property description not found.");
        await EnsureAccessAsync(userId, role, section.PropertyId, true, cancellationToken);

        if (await dbContext.PropertyDescriptionSections.AsNoTracking().AnyAsync(
                item => item.PropertyId == section.PropertyId &&
                        item.SectionType == request.SectionType &&
                        item.Id != descriptionId,
                cancellationToken))
        {
            throw new InvalidOperationException("A description with this section type already exists.");
        }

        section.SectionType = request.SectionType;
        section.Title = request.Title.Trim();
        section.Content = request.Content.Trim();
        section.SortOrder = request.SortOrder;
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(section);
    }

    private async Task EnsureAccessAsync(int userId, UserRole role, int propertyId, bool manage, CancellationToken cancellationToken)
    {
        var allowed = manage
            ? await propertyAccessService.CanManagePropertyAsync(userId, role, propertyId, cancellationToken)
            : await propertyAccessService.CanViewAsync(userId, role, propertyId, cancellationToken);
        if (!allowed)
        {
            throw new UnauthorizedAccessException("You cannot access this property's descriptions.");
        }
    }

    private static PropertyDescriptionSectionResponse Map(PropertyDescriptionSection section) => new()
    {
        Id = section.Id,
        PropertyId = section.PropertyId,
        SectionType = section.SectionType,
        Title = section.Title,
        Content = section.Content,
        SortOrder = section.SortOrder
    };
}
