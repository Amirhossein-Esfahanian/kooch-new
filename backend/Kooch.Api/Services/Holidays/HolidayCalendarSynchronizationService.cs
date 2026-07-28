using System.Security.Cryptography;
using System.Text;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Services.Holidays;

public sealed class HolidayCalendarSynchronizationService(
    KoochDbContext dbContext,
    IHolidayProvider holidayProvider,
    IOptions<HolidayCalendarSynchronizationOptions> options,
    ILogger<HolidayCalendarSynchronizationService> logger,
    TimeProvider timeProvider) : IHolidayCalendarSynchronizationService
{
    private const int MaximumSafeErrorSummaryLength = 1000;
    private readonly HolidayCalendarSynchronizationOptions synchronizationOptions = options.Value;

    public Task<HolidayCalendarSynchronizationResult> SyncYearAsync(int solarYear, CancellationToken cancellationToken = default) =>
        SyncAsync(solarYear, 0, cancellationToken);

    public Task<HolidayCalendarSynchronizationResult> SyncWindowAsync(
        int currentSolarYear,
        int yearsAhead,
        CancellationToken cancellationToken = default) =>
        SyncAsync(currentSolarYear, yearsAhead, cancellationToken);

    private async Task<HolidayCalendarSynchronizationResult> SyncAsync(
        int firstSolarYear,
        int yearsAhead,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var attemptedAtUtc = timeProvider.GetUtcNow().UtcDateTime;

        if (!TryCreateRequestedYears(firstSolarYear, yearsAhead, out var requestedYears))
        {
            const string summary = "The requested Solar Hijri synchronization window is invalid.";
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(firstSolarYear, firstSolarYear, [], HolidayCalendarSynchronizationFailureCategory.InvalidRequest, summary);
        }

        var lastSolarYear = requestedYears[^1];
        if (!synchronizationOptions.Enabled)
        {
            const string summary = "Holiday calendar synchronization is disabled.";
            var outcomes = requestedYears.Select(year => new HolidayCalendarYearSynchronizationResult(
                year, false, false, 0, HolidayCalendarSynchronizationFailureCategory.Disabled, summary));
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(firstSolarYear, lastSolarYear, outcomes, HolidayCalendarSynchronizationFailureCategory.Disabled, summary);
        }

        if (string.IsNullOrWhiteSpace(synchronizationOptions.ProviderName) ||
            synchronizationOptions.MaximumEventTitleLength <= 0)
        {
            const string summary = "Holiday calendar synchronization configuration is invalid.";
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(firstSolarYear, lastSolarYear, [], HolidayCalendarSynchronizationFailureCategory.InvalidRequest, summary);
        }

        var fetchedYears = new List<HolidayProviderYear>(requestedYears.Length);
        var yearOutcomes = new List<HolidayCalendarYearSynchronizationResult>(requestedYears.Length);
        var fetchFailed = false;

        foreach (var solarYear in requestedYears)
        {
            try
            {
                var fetchedYear = await holidayProvider.FetchYearAsync(solarYear, cancellationToken);
                fetchedYears.Add(fetchedYear);
                yearOutcomes.Add(new HolidayCalendarYearSynchronizationResult(
                    solarYear, true, false, fetchedYear.Holidays.Count));
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (HolidayProviderException exception)
            {
                fetchFailed = true;
                var summary = SafeProviderError(exception.FailureKind);
                logger.LogWarning(
                    "Holiday provider fetch failed for Solar Hijri year {SolarYear} with category {FailureKind}.",
                    solarYear,
                    exception.FailureKind);
                yearOutcomes.Add(new HolidayCalendarYearSynchronizationResult(
                    solarYear, false, false, 0, HolidayCalendarSynchronizationFailureCategory.Provider, summary));
            }
        }

        if (fetchFailed)
        {
            const string summary = "One or more holiday provider years could not be fetched.";
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(
                firstSolarYear, lastSolarYear, yearOutcomes, HolidayCalendarSynchronizationFailureCategory.Provider, summary);
        }

        IReadOnlyList<HolidayCalendarNormalizedYear> normalizedYears;
        try
        {
            normalizedYears = HolidayCalendarSnapshotValidator.ValidateAndNormalize(fetchedYears, requestedYears,
                synchronizationOptions.ProviderName.Trim(), synchronizationOptions.MaximumEventTitleLength);
            yearOutcomes = normalizedYears.Select(year => new HolidayCalendarYearSynchronizationResult(
                year.SolarYear, true, true, year.Holidays.Count)).ToList();
        }
        catch (HolidayCalendarSnapshotValidationException exception)
        {
            logger.LogWarning(
                "Holiday synchronization validation failed for Solar Hijri year {SolarYear}.",
                exception.SolarYear);
            const string summary = "The holiday provider snapshot failed synchronization validation.";
            yearOutcomes = requestedYears.Select(year => new HolidayCalendarYearSynchronizationResult(
                year, true, false, fetchedYears.FirstOrDefault(fetched => fetched.RequestedSolarYear == year)
                    ?.Holidays.Count ?? 0,
                HolidayCalendarSynchronizationFailureCategory.Validation,
                year == exception.SolarYear || exception.SolarYear is null ? summary : null)).ToList();
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(
                firstSolarYear, lastSolarYear, yearOutcomes, HolidayCalendarSynchronizationFailureCategory.Validation, summary);
        }

        cancellationToken.ThrowIfCancellationRequested();
        return await WriteSnapshotAsync(
            normalizedYears, yearOutcomes, firstSolarYear, lastSolarYear, attemptedAtUtc, cancellationToken);
    }

    private async Task<HolidayCalendarSynchronizationResult> WriteSnapshotAsync(
        IReadOnlyList<HolidayCalendarNormalizedYear> normalizedYears,
        IReadOnlyList<HolidayCalendarYearSynchronizationResult> yearOutcomes,
        int firstSolarYear,
        int lastSolarYear,
        DateTime attemptedAtUtc,
        CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;

        try
        {
            transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var holidays = normalizedYears.SelectMany(year => year.Holidays).ToArray();
            var snapshotDates = holidays.Select(holiday => holiday.GregorianDate).ToHashSet();
            var providerName = synchronizationOptions.ProviderName.Trim();
            var existingDays = await dbContext.HolidayCalendarDays
                .Include(day => day.Occasions)
                .Include(day => day.Override)
                .Where(day => snapshotDates.Contains(day.GregorianDate) ||
                    (day.ProviderName == providerName &&
                     day.SourceSolarYear >= firstSolarYear && day.SourceSolarYear <= lastSolarYear))
                .ToListAsync(cancellationToken);
            var statistics = ApplySnapshot(
                holidays,
                existingDays,
                snapshotDates,
                providerName,
                firstSolarYear,
                lastSolarYear,
                attemptedAtUtc);
            var syncState = await GetOrCreateSyncStateAsync(providerName, cancellationToken);

            syncState.LastAttemptAtUtc = attemptedAtUtc;
            syncState.LastSuccessfulSyncAtUtc = attemptedAtUtc;
            syncState.LastSuccessfulSolarYearFrom = firstSolarYear;
            syncState.LastSuccessfulSolarYearTo = lastSolarYear;
            syncState.LastResponseHash = CreateSnapshotHash(normalizedYears);
            syncState.LastErrorSummary = null;

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return HolidayCalendarSynchronizationResult.Success(
                firstSolarYear, lastSolarYear, yearOutcomes, statistics);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }

            dbContext.ChangeTracker.Clear();
            throw;
        }
        catch (Exception exception)
        {
            if (transaction is not null)
            {
                try
                {
                    await transaction.RollbackAsync(CancellationToken.None);
                }
                catch (Exception rollbackException)
                {
                    logger.LogError(rollbackException, "Holiday synchronization transaction rollback failed.");
                }
            }
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
                transaction = null;
            }

            logger.LogError(exception, "Holiday synchronization database write failed.");
            dbContext.ChangeTracker.Clear();
            const string summary = "The holiday calendar snapshot could not be saved.";
            await RecordFailureAsync(attemptedAtUtc, summary, cancellationToken);
            return HolidayCalendarSynchronizationResult.Failure(
                firstSolarYear, lastSolarYear, yearOutcomes, HolidayCalendarSynchronizationFailureCategory.Database, summary);
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private HolidayCalendarSynchronizationStatistics ApplySnapshot(
        IReadOnlyList<HolidayCalendarNormalizedDay> holidays,
        IReadOnlyList<HolidayCalendarDay> existingDays,
        HashSet<DateOnly> snapshotDates,
        string providerName,
        int firstSolarYear,
        int lastSolarYear,
        DateTime attemptedAtUtc)
    {
        var existingByDate = existingDays.ToDictionary(day => day.GregorianDate);
        var insertedDayCount = 0;
        var updatedDayCount = 0;
        var removedObsoleteDayCount = 0;
        var preservedObsoleteDayCount = 0;
        var insertedOccasionCount = 0;
        var removedOrReplacedOccasionCount = 0;

        foreach (var holiday in holidays)
        {
            var providerFields = HolidayCalendarProviderDayFields.FromSnapshot(
                holiday, providerName, attemptedAtUtc);
            if (!existingByDate.TryGetValue(holiday.GregorianDate, out var day))
            {
                day = new HolidayCalendarDay { GregorianDate = holiday.GregorianDate };
                providerFields.ApplyTo(day);
                foreach (var occasion in holiday.Occasions)
                {
                    day.Occasions.Add(CreateProviderOccasion(occasion));
                    insertedOccasionCount++;
                }

                dbContext.HolidayCalendarDays.Add(day);
                existingByDate.Add(day.GregorianDate, day);
                insertedDayCount++;
                continue;
            }

            if (providerFields.HasSemanticChanges(day))
            {
                updatedDayCount++;
            }

            providerFields.ApplyTo(day);
            ReconcileProviderOccasions(
                day, holiday.Occasions, ref insertedOccasionCount, ref removedOrReplacedOccasionCount);
        }

        foreach (var obsoleteDay in existingDays.Where(day =>
                     day.ProviderName == providerName &&
                     day.SourceSolarYear >= firstSolarYear &&
                     day.SourceSolarYear <= lastSolarYear &&
                     !snapshotDates.Contains(day.GregorianDate)))
        {
            var hasManualData = obsoleteDay.Override is not null ||
                                obsoleteDay.Occasions.Any(occasion =>
                                    occasion.Source == HolidayCalendarOccasionSource.Manual);
            if (!hasManualData)
            {
                removedOrReplacedOccasionCount += obsoleteDay.Occasions.Count(occasion =>
                    occasion.Source == HolidayCalendarOccasionSource.Provider);
                dbContext.HolidayCalendarDays.Remove(obsoleteDay);
                removedObsoleteDayCount++;
                continue;
            }

            var providerOccasions = obsoleteDay.Occasions
                .Where(occasion => occasion.Source == HolidayCalendarOccasionSource.Provider).ToArray();
            dbContext.HolidayCalendarOccasions.RemoveRange(providerOccasions);
            removedOrReplacedOccasionCount += providerOccasions.Length;
            preservedObsoleteDayCount++;
        }

        return new HolidayCalendarSynchronizationStatistics(
            insertedDayCount,
            updatedDayCount,
            removedObsoleteDayCount,
            preservedObsoleteDayCount,
            insertedOccasionCount,
            removedOrReplacedOccasionCount);
    }

    private async Task<HolidayCalendarSyncState> GetOrCreateSyncStateAsync(
        string providerName,
        CancellationToken cancellationToken)
    {
        var syncState = await dbContext.HolidayCalendarSyncStates.SingleOrDefaultAsync(
            state => state.ProviderName == providerName, cancellationToken);
        if (syncState is not null)
        {
            return syncState;
        }

        syncState = new HolidayCalendarSyncState { ProviderName = providerName };
        dbContext.HolidayCalendarSyncStates.Add(syncState);
        return syncState;
    }

    private async Task RecordFailureAsync(DateTime attemptedAtUtc, string errorSummary, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(synchronizationOptions.ProviderName))
        {
            return;
        }

        try
        {
            var providerName = synchronizationOptions.ProviderName.Trim();
            var syncState = await GetOrCreateSyncStateAsync(providerName, cancellationToken);

            syncState.LastAttemptAtUtc = attemptedAtUtc;
            syncState.LastErrorSummary = Truncate(errorSummary, MaximumSafeErrorSummaryLength);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            dbContext.ChangeTracker.Clear();
            logger.LogError(exception, "Holiday synchronization failure metadata could not be saved.");
        }
    }

    private static void ReconcileProviderOccasions(
        HolidayCalendarDay day,
        IReadOnlyList<HolidayCalendarNormalizedOccasion> desiredOccasions,
        ref int insertedCount,
        ref int removedOrReplacedCount)
    {
        var desiredByTitle = desiredOccasions.ToDictionary(occasion => occasion.NormalizedTitle, StringComparer.Ordinal);
        var existingProviderOccasions = day.Occasions
            .Where(occasion => occasion.Source == HolidayCalendarOccasionSource.Provider).ToArray();

        foreach (var existingOccasion in existingProviderOccasions)
        {
            if (!desiredByTitle.Remove(existingOccasion.NormalizedTitle, out var desiredOccasion))
            {
                day.Occasions.Remove(existingOccasion);
                removedOrReplacedCount++;
                continue;
            }

            if (!string.Equals(existingOccasion.Title, desiredOccasion.Title, StringComparison.Ordinal))
            {
                existingOccasion.Title = desiredOccasion.Title;
                removedOrReplacedCount++;
            }
        }

        foreach (var occasion in desiredByTitle.Values)
        {
            day.Occasions.Add(CreateProviderOccasion(occasion));
            insertedCount++;
        }
    }

    private static HolidayCalendarOccasion CreateProviderOccasion(HolidayCalendarNormalizedOccasion occasion) => new()
    {
        Title = occasion.Title,
        NormalizedTitle = occasion.NormalizedTitle,
        Source = HolidayCalendarOccasionSource.Provider
    };

    private static string CreateSnapshotHash(IReadOnlyList<HolidayCalendarNormalizedYear> normalizedYears)
    {
        var builder = new StringBuilder();
        foreach (var holiday in normalizedYears.SelectMany(year => year.Holidays).OrderBy(holiday => holiday.GregorianDate))
        {
            builder.Append(holiday.GregorianDate.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))
                .Append('|')
                .Append(holiday.SolarYear)
                .Append('-').Append(holiday.SolarMonth)
                .Append('-').Append(holiday.SolarDay)
                .Append('|')
                .Append(holiday.IsWeeklyHoliday ? 'W' : 'O');
            foreach (var occasion in holiday.Occasions.OrderBy(occasion => occasion.NormalizedTitle, StringComparer.Ordinal))
            {
                builder.Append('|').Append(occasion.NormalizedTitle);
            }

            builder.Append('\n');
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }

    private static string SafeProviderError(HolidayProviderFailureKind failureKind) => failureKind switch
    {
        HolidayProviderFailureKind.Disabled => "The holiday provider is disabled.",
        HolidayProviderFailureKind.NetworkOrTimeout => "The holiday provider could not be reached.",
        HolidayProviderFailureKind.Http => "The holiday provider returned an unsuccessful response.",
        HolidayProviderFailureKind.SchemaOrDeserialization => "The holiday provider response schema was invalid.",
        HolidayProviderFailureKind.Validation => "The holiday provider response failed validation.",
        _ => "The holiday provider request failed."
    };

    private static bool TryCreateRequestedYears(int firstSolarYear, int yearsAhead, out int[] requestedYears)
    {
        requestedYears = [];
        if (firstSolarYear is < 1 or > 3000 || yearsAhead < 0 || yearsAhead > 100)
        {
            return false;
        }

        try
        {
            requestedYears = Enumerable.Range(firstSolarYear, checked(yearsAhead + 1)).ToArray();
            return requestedYears[^1] <= 3000;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];
}
