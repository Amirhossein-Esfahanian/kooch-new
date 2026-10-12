using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class UpdatePropertyBasicSectionRequest
{
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? EnglishName { get; set; }

    public PropertyType Type { get; set; }
    public InventoryMode InventoryMode { get; set; }
}

public class UpdatePropertyLocationSectionRequest : PropertyCoordinatesRequest
{
    [Range(1, int.MaxValue)]
    public int DestinationId { get; set; }

    [MaxLength(500)]
    public string Address { get; set; } = string.Empty;

    [MaxLength(100)]
    public string City { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Country { get; set; } = string.Empty;
}

public class UpdatePropertyBuildingSectionRequest
{
    [Range(0, double.MaxValue)]
    public decimal? TotalAreaM2 { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? LandAreaM2 { get; set; }

    [Range(1, int.MaxValue)]
    public int? FloorsCount { get; set; }

    public bool HasElevator { get; set; }
    public bool? IsWheelchairAccessible { get; set; }
    public bool? HasGroundFloorRoom { get; set; }
    public bool? HasAccessibleBathroom { get; set; }
}

public class UpdatePropertyRulesSectionRequest
{
    public TimeOnly? CheckInTime { get; set; }
    public TimeOnly? CheckOutTime { get; set; }

    private TimeOnly? regularReceptionFrom;
    private TimeOnly? regularReceptionUntil;
    private TimeOnly? sameNightInstantBookingTime;
    private short? sameNightInstantBookingDayOffset;
    private TimeOnly? sameNightFinalBookingTime;
    private short? sameNightFinalBookingDayOffset;

    internal bool HasRegularReceptionFrom { get; private set; }
    internal bool HasRegularReceptionUntil { get; private set; }
    internal bool HasSameNightInstantBookingTime { get; private set; }
    internal bool HasSameNightInstantBookingDayOffset { get; private set; }
    internal bool HasSameNightFinalBookingTime { get; private set; }
    internal bool HasSameNightFinalBookingDayOffset { get; private set; }

    public TimeOnly? RegularReceptionFrom
    {
        get => regularReceptionFrom;
        set { regularReceptionFrom = value; HasRegularReceptionFrom = true; }
    }

    public TimeOnly? RegularReceptionUntil
    {
        get => regularReceptionUntil;
        set { regularReceptionUntil = value; HasRegularReceptionUntil = true; }
    }

    public TimeOnly? SameNightInstantBookingTime
    {
        get => sameNightInstantBookingTime;
        set { sameNightInstantBookingTime = value; HasSameNightInstantBookingTime = true; }
    }

    public short? SameNightInstantBookingDayOffset
    {
        get => sameNightInstantBookingDayOffset;
        set { sameNightInstantBookingDayOffset = value; HasSameNightInstantBookingDayOffset = true; }
    }

    public TimeOnly? SameNightFinalBookingTime
    {
        get => sameNightFinalBookingTime;
        set { sameNightFinalBookingTime = value; HasSameNightFinalBookingTime = true; }
    }

    public short? SameNightFinalBookingDayOffset
    {
        get => sameNightFinalBookingDayOffset;
        set { sameNightFinalBookingDayOffset = value; HasSameNightFinalBookingDayOffset = true; }
    }
}

public class UpdatePropertyFinancialSectionRequest
{
    [Range(0, 17)]
    public int? FreeChildAgeLimit { get; set; }

    [Range(0, int.MaxValue)]
    public int? MaxFreeChildren { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? ChildPrice { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? ExtraGuestPrice { get; set; }
    public bool? HasSeparateForeignPricing { get; set; }
}

public class UpdatePropertyDescriptionSectionRequest
{
    [MaxLength(4000)]
    public string Description { get; set; } = string.Empty;
}

public class UpdatePropertySeoSectionRequest
{
    [MaxLength(200)]
    public string? SeoTitle { get; set; }

    [MaxLength(500)]
    public string? SeoDescription { get; set; }
}
