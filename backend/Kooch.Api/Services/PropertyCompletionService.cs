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
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var state = await dbContext.Properties.AsNoTracking()
            .Where(property => property.Id == propertyId)
            .Select(property => new
            {
                BasicName = property.Name != "",
                BasicEnglishName = property.EnglishName != null && property.EnglishName != "",
                BasicDescription = property.Description != "",
                Address = property.Address != "",
                City = property.City != "",
                Coordinates = property.Latitude != null && property.Longitude != null,
                Images = property.Images.Any(image => image.RoomTypeId == null && image.RoomId == null),
                Amenities = property.PropertyAmenities.Any(),
                PoliciesCheckIn = property.CheckInTime != null,
                PoliciesCheckOut = property.CheckOutTime != null,
                PaidBreakfastPrice = property.BreakfastOption != BreakfastOption.Paid || property.BreakfastPrice != null,
                ChildPriceSettings = property.FreeChildAgeLimit != null && property.MaxFreeChildren != null,
                Rooms = property.RoomTypes.Any(roomType => roomType.IsActive),
                Pricing = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    (roomType.BasePrice != null && roomType.BasePrice > 0 ||
                     roomType.DailyPrices.Any(price => price.BasePrice > 0))),
                Availability = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    roomType.Availability.Any(availability =>
                        availability.Date >= today &&
                        availability.Status != AvailabilityStatus.Unavailable &&
                        availability.AvailableCount > 0)),
                ChildPrice = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    roomType.DailyPrices.Any(price => price.ChildPrice > 0)),
                ExtraGuestPrice = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    roomType.DailyPrices.Any(price => price.ExtraGuestPrice > 0)),
            })
            .SingleAsync(cancellationToken);

        var sections = new[]
        {
            Section(
                "basic",
                "اطلاعات پایه",
                "basic",
                [
                    (state.BasicName, "نام فارسی"),
                    (state.BasicEnglishName, "نام انگلیسی"),
                    (state.BasicDescription, "توضیحات اقامتگاه")
                ],
                started: state.BasicName || state.BasicEnglishName || state.BasicDescription),
            Section(
                "location",
                "نشانی و موقعیت",
                "location",
                [
                    (state.City, "شهر"),
                    (state.Address, "نشانی")
                ],
                started: state.City || state.Address || state.Coordinates),
            Section(
                "images",
                "تصاویر",
                "images",
                [(state.Images, "حداقل یک تصویر")],
                started: state.Images),
            Section(
                "amenities",
                "امکانات",
                "amenities",
                [(state.Amenities, "حداقل یک امکان")],
                started: state.Amenities),
            Section(
                "policies",
                "قوانین و زمان‌ها",
                "policies",
                [
                    (state.PoliciesCheckIn, "ساعت ورود"),
                    (state.PoliciesCheckOut, "ساعت خروج"),
                    (state.PaidBreakfastPrice, "قیمت صبحانه پولی")
                ],
                started: state.PoliciesCheckIn || state.PoliciesCheckOut),
            Section(
                "financial",
                "تنظیمات مالی",
                "financial",
                [
                    (state.ChildPriceSettings, "قانون قیمت کودک"),
                    (state.ChildPrice, "قیمت کودک"),
                    (state.ExtraGuestPrice, "قیمت نفر اضافه")
                ],
                started: state.ChildPriceSettings || state.ChildPrice || state.ExtraGuestPrice),
            Section(
                "rooms",
                "اتاق‌ها",
                "rooms",
                [(state.Rooms, "حداقل یک اتاق فعال")],
                started: state.Rooms),
            Section(
                "pricing",
                "قیمت‌گذاری",
                "pricing",
                [(state.Pricing, "حداقل یک قیمت ثبت‌شده")],
                started: state.Pricing),
            Section(
                "availability",
                "موجودی",
                "availability",
                [(state.Availability, "حداقل یک روز موجود")],
                started: state.Availability),
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
            Warnings = BuildWarnings(state.Images, state.Rooms, state.Pricing, state.Availability, state.ChildPriceSettings, state.ChildPrice, state.ExtraGuestPrice),
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

    private static IReadOnlyList<string> BuildWarnings(
        bool hasImages,
        bool hasRooms,
        bool hasPricing,
        bool hasAvailability,
        bool hasFinancialSettings,
        bool hasChildPrice,
        bool hasExtraGuestPrice)
    {
        var warnings = new List<string>();
        if (!hasImages) warnings.Add("تصویری برای اقامتگاه ثبت نشده است.");
        if (!hasRooms) warnings.Add("هیچ اتاق فعالی ثبت نشده است.");
        if (!hasPricing) warnings.Add("قیمت‌گذاری اقامتگاه کامل نیست.");
        if (!hasAvailability) warnings.Add("موجودی قابل رزرو ثبت نشده است.");
        if (!hasChildPrice) warnings.Add("قیمت کودک ثبت نشده است.");
        if (!hasExtraGuestPrice) warnings.Add("قیمت نفر اضافه ثبت نشده است.");
        if (!hasFinancialSettings) warnings.Add("تنظیمات مالی اقامتگاه کامل نیست.");
        return warnings;
    }
}
