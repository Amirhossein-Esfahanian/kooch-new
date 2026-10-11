using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class PropertyCompletionService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService,
    IPropertyStandardStayReadinessService standardStayReadinessService) : IPropertyCompletionService
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
                Rooms = property.RoomTypes.Any(roomType => roomType.IsActive),
                HasActiveExtraGuestRoomType = property.RoomTypes.Any(roomType =>
                    roomType.IsActive && roomType.AllowExtraGuest && roomType.MaxExtraGuests > 0),
                PricingStarted = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    (roomType.BasePrice != null && roomType.BasePrice > 0 ||
                     roomType.DailyPrices.Any())),
                AvailabilityStarted = property.RoomTypes.Any(roomType =>
                    roomType.IsActive &&
                    (roomType.TotalInventory > 0 || roomType.Availability.Any())),
                HasExtraGuestPrice = property.ExtraGuestPrice != null,
            })
            .SingleAsync(cancellationToken);
        var readiness = await standardStayReadinessService.EvaluateAsync(propertyId, today, cancellationToken);

        var sections = new[]
        {
            Section(
                "basic",
                "اطلاعات پایه",
                "basic",
                [
                    (state.BasicName, "نام فارسی"),
                    (state.BasicDescription, "توضیحات اقامتگاه")
                ],
                started: state.BasicName || state.BasicDescription),
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
                [],
                started: true),
            Section(
                "policies",
                "قوانین و زمان‌ها",
                "policies",
                [
                    (state.PoliciesCheckIn, "ساعت ورود"),
                    (state.PoliciesCheckOut, "ساعت خروج")
                ],
                started: state.PoliciesCheckIn || state.PoliciesCheckOut),
            Section(
                "financial",
                "تنظیمات مالی",
                "financial",
                [(!state.HasActiveExtraGuestRoomType || state.HasExtraGuestPrice, "قیمت نفر اضافه")],
                started: state.HasActiveExtraGuestRoomType || state.HasExtraGuestPrice),
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
                [(readiness.HasValidDailyPricing, "حداقل یک قیمت روزانه معتبر")],
                started: state.PricingStarted || readiness.HasValidDailyPricing),
            Section(
                "availability",
                "موجودی",
                "availability",
                [(readiness.HasJointStandardStay, "حداقل یک تاریخ دارای قیمت و موجودی قابل رزرو")],
                started: state.AvailabilityStarted || readiness.HasValidConfiguredAvailability),
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
            Warnings = BuildWarnings(state.BasicEnglishName, state.Amenities, state.Images, state.Rooms, readiness.HasValidDailyPricing, readiness.HasJointStandardStay, state.HasActiveExtraGuestRoomType && !state.HasExtraGuestPrice),
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
        bool hasEnglishName,
        bool hasAmenities,
        bool hasImages,
        bool hasRooms,
        bool hasPricing,
        bool hasAvailability,
        bool isExtraGuestPriceMissing)
    {
        var warnings = new List<string>();
        if (!hasEnglishName) warnings.Add("نام انگلیسی اقامتگاه ثبت نشده است.");
        if (!hasAmenities) warnings.Add("امکانات اقامتگاه ثبت نشده است.");
        if (!hasImages) warnings.Add("تصویری برای اقامتگاه ثبت نشده است.");
        if (!hasRooms) warnings.Add("هیچ اتاق فعالی ثبت نشده است.");
        if (!hasPricing) warnings.Add("قیمت‌گذاری اقامتگاه کامل نیست.");
        if (!hasAvailability) warnings.Add("موجودی قابل رزرو ثبت نشده است.");
        if (isExtraGuestPriceMissing) warnings.Add("قیمت نفر اضافه ثبت نشده است.");
        return warnings;
    }
}
