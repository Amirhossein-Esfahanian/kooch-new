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

        return await CalculateAsync(propertyId, cancellationToken);
    }

    public async Task<PropertyCompletionResponse> CalculateAsync(
        int propertyId,
        CancellationToken cancellationToken = default)
    {
        // Use current tracked values when an Admin full update also requests approval.
        var property = await dbContext.Properties.SingleAsync(item => item.Id == propertyId, cancellationToken);
        var hasImage = await dbContext.PropertyImages.AsNoTracking().AnyAsync(image =>
            image.PropertyId == propertyId && image.RoomTypeId == null && image.RoomId == null &&
            image.Url.Trim() != "" && image.Url.Length <= 2000, cancellationToken);
        var hasAmenities = await dbContext.PropertyAmenities.AsNoTracking()
            .AnyAsync(item => item.PropertyId == propertyId, cancellationToken);

        var sections = new[]
        {
            Section(
                "basic",
                "اطلاعات پایه",
                "basic",
                [
                    (HasText(property.Name, 200), "نام فارسی")
                ],
                started: !string.IsNullOrWhiteSpace(property.Name)),
            Section(
                "descriptions",
                "توضیحات اقامتگاه",
                "descriptions",
                [(HasText(property.Description, 4000), "توضیحات اقامتگاه")],
                started: !string.IsNullOrWhiteSpace(property.Description)),
            Section(
                "location",
                "نشانی و موقعیت",
                "location",
                [
                    (HasText(property.Country, 100), "کشور"),
                    (HasText(property.City, 100), "شهر"),
                    (HasText(property.Address, 500), "نشانی")
                ],
                started: !string.IsNullOrWhiteSpace(property.Country) ||
                    !string.IsNullOrWhiteSpace(property.City) || !string.IsNullOrWhiteSpace(property.Address)),
            Section(
                "images",
                "تصاویر",
                "images",
                [(hasImage, "حداقل یک تصویر")],
                started: hasImage),
            Section(
                "policies",
                "قوانین و زمان‌ها",
                "policies",
                [
                    (property.CheckInTime.HasValue, "ساعت ورود"),
                    (property.CheckOutTime.HasValue, "ساعت خروج")
                ],
                started: property.CheckInTime.HasValue || property.CheckOutTime.HasValue),
        };

        var completedSections = sections
            .Where(section => section.Status == PropertyCompletionSectionStatus.Complete)
            .Select(section => section.Key)
            .ToArray();
        var missingSections = sections
            .Where(section => section.Status != PropertyCompletionSectionStatus.Complete)
            .Select(section => section.Key)
            .ToArray();
        var completionPercentage = (int)Math.Round(
            completedSections.Length / (decimal)sections.Length * 100m,
            MidpointRounding.AwayFromZero);
        var warnings = new List<string>();
        if (string.IsNullOrWhiteSpace(property.EnglishName)) warnings.Add("نام انگلیسی اقامتگاه ثبت نشده است.");
        if (!hasAmenities) warnings.Add("امکانات اقامتگاه ثبت نشده است.");

        return new PropertyCompletionResponse
        {
            PropertyId = propertyId,
            CompletionPercentage = completionPercentage,
            HealthStatus = completionPercentage >= 90
                ? PropertyHealthStatus.Ready
                : completionPercentage >= 60
                    ? PropertyHealthStatus.NeedsAttention
                    : PropertyHealthStatus.Incomplete,
            Sections = sections,
            Warnings = warnings,
            CompletedSections = completedSections,
            MissingSections = missingSections,
            CanActivate = missingSections.Length == 0
        };
    }

    private static PropertyCompletionSectionResponse Section(
        string key,
        string label,
        string actionTarget,
        IReadOnlyList<(bool IsComplete, string MissingLabel)> requiredItems,
        bool started)
    {
        var missingItems = requiredItems
            .Where(item => !item.IsComplete)
            .Select(item => item.MissingLabel)
            .ToArray();

        return new PropertyCompletionSectionResponse
        {
            Key = key,
            Label = label,
            ActionTarget = actionTarget,
            MissingItems = missingItems,
            Status = missingItems.Length == 0
                ? PropertyCompletionSectionStatus.Complete
                : started
                    ? PropertyCompletionSectionStatus.Incomplete
                    : PropertyCompletionSectionStatus.NotStarted
        };
    }

    private static bool HasText(string? value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= maxLength;
}
