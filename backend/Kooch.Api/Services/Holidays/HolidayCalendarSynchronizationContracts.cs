using System.Collections.ObjectModel;

namespace Kooch.Api.Services.Holidays;

public enum HolidayCalendarSynchronizationFailureCategory
{
    Disabled,
    InvalidRequest,
    Provider,
    Validation,
    Database
}

public sealed record HolidayCalendarYearSynchronizationResult(
    int SolarYear,
    bool FetchSucceeded,
    bool ValidationSucceeded,
    int HolidayCount,
    HolidayCalendarSynchronizationFailureCategory? FailureCategory = null,
    string? ErrorSummary = null);

internal sealed record HolidayCalendarSynchronizationStatistics(
    int InsertedDayCount,
    int UpdatedDayCount,
    int RemovedObsoleteProviderHolidayCount,
    int PreservedObsoleteProviderHolidayCount,
    int InsertedProviderOccasionCount,
    int RemovedOrReplacedProviderOccasionCount);

public sealed record HolidayCalendarSynchronizationResult
{
    internal static HolidayCalendarSynchronizationResult Success(
        int requestedSolarYearFrom,
        int requestedSolarYearTo,
        IEnumerable<HolidayCalendarYearSynchronizationResult> years,
        HolidayCalendarSynchronizationStatistics statistics) => new(
        true,
        requestedSolarYearFrom,
        requestedSolarYearTo,
        years,
        statistics.InsertedDayCount,
        statistics.UpdatedDayCount,
        statistics.RemovedObsoleteProviderHolidayCount,
        statistics.PreservedObsoleteProviderHolidayCount,
        statistics.InsertedProviderOccasionCount,
        statistics.RemovedOrReplacedProviderOccasionCount);

    internal static HolidayCalendarSynchronizationResult Failure(
        int requestedSolarYearFrom,
        int requestedSolarYearTo,
        IEnumerable<HolidayCalendarYearSynchronizationResult> years,
        HolidayCalendarSynchronizationFailureCategory failureCategory,
        string errorSummary) => new(
        false,
        requestedSolarYearFrom,
        requestedSolarYearTo,
        years,
        failureCategory: failureCategory,
        errorSummary: errorSummary);

    public HolidayCalendarSynchronizationResult(
        bool succeeded,
        int requestedSolarYearFrom,
        int requestedSolarYearTo,
        IEnumerable<HolidayCalendarYearSynchronizationResult> years,
        int insertedDayCount = 0,
        int updatedDayCount = 0,
        int removedObsoleteProviderHolidayCount = 0,
        int preservedObsoleteProviderHolidayCount = 0,
        int insertedProviderOccasionCount = 0,
        int removedOrReplacedProviderOccasionCount = 0,
        HolidayCalendarSynchronizationFailureCategory? failureCategory = null,
        string? errorSummary = null)
    {
        ArgumentNullException.ThrowIfNull(years);

        Succeeded = succeeded;
        RequestedSolarYearFrom = requestedSolarYearFrom;
        RequestedSolarYearTo = requestedSolarYearTo;
        Years = new ReadOnlyCollection<HolidayCalendarYearSynchronizationResult>(years.ToArray());
        InsertedDayCount = insertedDayCount;
        UpdatedDayCount = updatedDayCount;
        RemovedObsoleteProviderHolidayCount = removedObsoleteProviderHolidayCount;
        PreservedObsoleteProviderHolidayCount = preservedObsoleteProviderHolidayCount;
        InsertedProviderOccasionCount = insertedProviderOccasionCount;
        RemovedOrReplacedProviderOccasionCount = removedOrReplacedProviderOccasionCount;
        FailureCategory = failureCategory;
        ErrorSummary = errorSummary;
    }

    public bool Succeeded { get; }
    public int RequestedSolarYearFrom { get; }
    public int RequestedSolarYearTo { get; }
    public IReadOnlyList<HolidayCalendarYearSynchronizationResult> Years { get; }
    public int InsertedDayCount { get; }
    public int UpdatedDayCount { get; }
    public int RemovedObsoleteProviderHolidayCount { get; }
    public int PreservedObsoleteProviderHolidayCount { get; }
    public int InsertedProviderOccasionCount { get; }
    public int RemovedOrReplacedProviderOccasionCount { get; }
    public HolidayCalendarSynchronizationFailureCategory? FailureCategory { get; }
    public string? ErrorSummary { get; }
}
