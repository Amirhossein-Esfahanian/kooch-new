using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Kooch.Api.Services.Holidays;
using Microsoft.Extensions.Options;

namespace Kooch.Api.Integrations.PnlDev;

public sealed class PnlDevHolidayProvider : IHolidayProvider
{
    private const string ProviderName = "PNLdev";
    private const int MaximumEventsPerDay = 32;
    private const int MaximumEventTitleLength = 512;

    private static readonly PersianCalendar PersianCalendar = new();
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = false
    };

    private readonly HttpClient _httpClient;
    private readonly PnlDevOptions _options;

    public PnlDevHolidayProvider(HttpClient httpClient, IOptions<PnlDevOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<HolidayProviderYear> FetchYearAsync(
        int solarHijriYear,
        CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.Disabled,
                "The PNLdev holiday provider is disabled.");
        }

        if (solarHijriYear is < 1 or > 3000)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.Validation,
                "The requested Solar Hijri year is outside the provider's supported range.");
        }

        if (_options.RequestTimeoutSeconds <= 0)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.Validation,
                "The PNLdev request timeout must be greater than zero.");
        }

        var requestUri = CreateRequestUri(solarHijriYear);
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(TimeSpan.FromSeconds(_options.RequestTimeoutSeconds));

        try
        {
            using var response = await _httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeoutSource.Token);

            if (!response.IsSuccessStatusCode)
            {
                throw new HolidayProviderException(
                    HolidayProviderFailureKind.Http,
                    $"PNLdev returned HTTP {(int)response.StatusCode}.",
                    statusCode: response.StatusCode);
            }

            await using var responseStream = await response.Content.ReadAsStreamAsync(timeoutSource.Token);
            var payload = await DeserializeAsync(responseStream, timeoutSource.Token);
            return NormalizeAndValidate(payload, solarHijriYear);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.NetworkOrTimeout,
                "The PNLdev request timed out.",
                exception);
        }
        catch (HttpRequestException exception)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.NetworkOrTimeout,
                "The PNLdev request failed due to a network error.",
                exception);
        }
    }

    private Uri CreateRequestUri(int solarHijriYear)
    {
        if (!Uri.TryCreate(_options.BaseUrl, UriKind.Absolute, out var baseUri) ||
            baseUri.Scheme != Uri.UriSchemeHttps)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.Validation,
                "The PNLdev base URL must be an absolute HTTPS URL.");
        }

        var separator = string.IsNullOrEmpty(baseUri.Query) ? "?" : "&";
        return new Uri(
            $"{baseUri}{separator}year={solarHijriYear.ToString(CultureInfo.InvariantCulture)}",
            UriKind.Absolute);
    }

    private static async Task<PnlDevCalendarResponseDto> DeserializeAsync(
        Stream responseStream,
        CancellationToken cancellationToken)
    {
        try
        {
            return await JsonSerializer.DeserializeAsync<PnlDevCalendarResponseDto>(
                    responseStream,
                    SerializerOptions,
                    cancellationToken)
                ?? throw SchemaException();
        }
        catch (JsonException exception)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.SchemaOrDeserialization,
                "The PNLdev response could not be deserialized.",
                exception);
        }
    }

    private static HolidayProviderYear NormalizeAndValidate(
        PnlDevCalendarResponseDto payload,
        int requestedSolarYear)
    {
        if (payload.Status != true)
        {
            throw ValidationException("PNLdev reported an unsuccessful response.");
        }

        if (payload.Result is not { ValueKind: JsonValueKind.Object } resultElement)
        {
            throw SchemaException();
        }

        Dictionary<string, Dictionary<string, PnlDevCalendarDayDto>> months;
        try
        {
            months = resultElement.Deserialize<Dictionary<string, Dictionary<string, PnlDevCalendarDayDto>>>(
                    SerializerOptions)
                ?? throw SchemaException();
        }
        catch (JsonException exception)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.SchemaOrDeserialization,
                "The PNLdev result has an unexpected schema.",
                exception);
        }

        var days = FlattenAndValidateStructure(months);
        ValidateCompleteYear(days, requestedSolarYear);

        var holidays = days
            .Where(day => day.Holiday!.Value)
            .OrderBy(day => day.Gregorian!.Year)
            .ThenBy(day => day.Gregorian!.Month)
            .ThenBy(day => day.Gregorian!.Day)
            .Select(NormalizeHoliday)
            .ToArray();

        return new HolidayProviderYear(
            ProviderName,
            requestedSolarYear,
            requestedSolarYear,
            holidays);
    }

    private static List<PnlDevCalendarDayDto> FlattenAndValidateStructure(
        Dictionary<string, Dictionary<string, PnlDevCalendarDayDto>> months)
    {
        var days = new List<PnlDevCalendarDayDto>();

        foreach (var (monthKey, month) in months)
        {
            if (!int.TryParse(monthKey, NumberStyles.None, CultureInfo.InvariantCulture, out var monthNumber) ||
                monthNumber is < 1 or > 12 ||
                month is null)
            {
                throw SchemaException();
            }

            foreach (var (dayKey, day) in month)
            {
                if (!int.TryParse(dayKey, NumberStyles.None, CultureInfo.InvariantCulture, out var dayNumber) ||
                    day is null ||
                    day.Solar is null ||
                    day.Moon is null ||
                    day.Gregorian is null ||
                    day.Holiday is null ||
                    day.Events is null ||
                    day.Solar.Year is null ||
                    day.Solar.Month is null ||
                    day.Solar.Day is null ||
                    string.IsNullOrWhiteSpace(day.Solar.DayOfWeek) ||
                    day.Moon.Year is null ||
                    day.Moon.Month is null ||
                    day.Moon.Day is null ||
                    day.Gregorian.Year is null ||
                    day.Gregorian.Month is null ||
                    day.Gregorian.Day is null ||
                    string.IsNullOrWhiteSpace(day.Gregorian.DayOfWeek) ||
                    day.Solar.Month.Value != monthNumber ||
                    day.Solar.Day.Value != dayNumber)
                {
                    throw SchemaException();
                }

                if (day.Events.Length > MaximumEventsPerDay ||
                    day.Events.Any(title => title is null || title.Trim().Length > MaximumEventTitleLength))
                {
                    throw ValidationException("PNLdev returned event titles outside the accepted bounds.");
                }

                if (day.Moon.Month.Value is < 1 or > 12 || day.Moon.Day.Value is < 1 or > 30)
                {
                    throw ValidationException("PNLdev returned an invalid lunar date.");
                }

                days.Add(day);
            }
        }

        return days;
    }

    private static void ValidateCompleteYear(
        IReadOnlyCollection<PnlDevCalendarDayDto> days,
        int requestedSolarYear)
    {
        int expectedDayCount;
        try
        {
            expectedDayCount = PersianCalendar.GetDaysInYear(requestedSolarYear);
        }
        catch (ArgumentOutOfRangeException exception)
        {
            throw new HolidayProviderException(
                HolidayProviderFailureKind.Validation,
                "The requested Solar Hijri year cannot be validated.",
                exception);
        }

        if (days.Count != expectedDayCount)
        {
            throw ValidationException("PNLdev returned an incomplete Solar Hijri year.");
        }

        var solarDates = new HashSet<(int Year, int Month, int Day)>();
        var gregorianDates = new HashSet<DateOnly>();

        foreach (var day in days)
        {
            var solar = day.Solar!;
            var gregorian = day.Gregorian!;
            var solarYear = solar.Year!.Value;
            var solarMonth = solar.Month!.Value;
            var solarDay = solar.Day!.Value;

            if (solarYear != requestedSolarYear ||
                solarMonth is < 1 or > 12 ||
                solarDay < 1 ||
                solarDay > PersianCalendar.GetDaysInMonth(solarYear, solarMonth))
            {
                throw ValidationException("PNLdev returned an invalid Solar Hijri date.");
            }

            DateOnly gregorianDate;
            try
            {
                gregorianDate = new DateOnly(
                    gregorian.Year!.Value,
                    gregorian.Month!.Value,
                    gregorian.Day!.Value);
            }
            catch (ArgumentOutOfRangeException exception)
            {
                throw new HolidayProviderException(
                    HolidayProviderFailureKind.Validation,
                    "PNLdev returned an invalid Gregorian date.",
                    exception);
            }

            var convertedDate = DateOnly.FromDateTime(PersianCalendar.ToDateTime(
                solarYear,
                solarMonth,
                solarDay,
                0,
                0,
                0,
                0));

            if (convertedDate != gregorianDate ||
                !solarDates.Add((solarYear, solarMonth, solarDay)) ||
                !gregorianDates.Add(gregorianDate))
            {
                throw ValidationException("PNLdev returned duplicate or inconsistent dates.");
            }

            ValidateWeekday(day, gregorianDate);
        }

        var firstDate = DateOnly.FromDateTime(PersianCalendar.ToDateTime(
            requestedSolarYear,
            1,
            1,
            0,
            0,
            0,
            0));

        for (var offset = 0; offset < expectedDayCount; offset++)
        {
            if (!gregorianDates.Contains(firstDate.AddDays(offset)))
            {
                throw ValidationException("PNLdev returned a non-continuous Gregorian date range.");
            }
        }
    }

    private static void ValidateWeekday(PnlDevCalendarDayDto day, DateOnly gregorianDate)
    {
        var expectedGregorianDay = gregorianDate.ToString("ddd", CultureInfo.InvariantCulture);
        var expectedSolarDay = gregorianDate.DayOfWeek switch
        {
            DayOfWeek.Saturday => "ش",
            DayOfWeek.Sunday => "ی",
            DayOfWeek.Monday => "د",
            DayOfWeek.Tuesday => "س",
            DayOfWeek.Wednesday => "چ",
            DayOfWeek.Thursday => "پ",
            DayOfWeek.Friday => "ج",
            _ => throw new InvalidOperationException("Unexpected day of week.")
        };

        if (!string.Equals(day.Gregorian!.DayOfWeek!.Trim(), expectedGregorianDay, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(day.Solar!.DayOfWeek!.Trim(), expectedSolarDay, StringComparison.Ordinal) ||
            (gregorianDate.DayOfWeek == DayOfWeek.Friday && day.Holiday != true))
        {
            throw ValidationException("PNLdev returned inconsistent weekday or Friday holiday data.");
        }
    }

    private static HolidayProviderDay NormalizeHoliday(PnlDevCalendarDayDto day)
    {
        var solar = day.Solar!;
        var gregorian = day.Gregorian!;
        var date = new DateOnly(gregorian.Year!.Value, gregorian.Month!.Value, gregorian.Day!.Value);
        var isWeeklyHoliday = date.DayOfWeek == DayOfWeek.Friday;
        var titles = isWeeklyHoliday
            ? Array.Empty<string>()
            : day.Events!
                .Select(title => title.Trim())
                .Where(title => title.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .ToArray();

        return new HolidayProviderDay(
            date,
            solar.Year!.Value,
            solar.Month!.Value,
            solar.Day!.Value,
            date.DayOfWeek,
            isWeeklyHoliday,
            !isWeeklyHoliday,
            titles);
    }

    private static HolidayProviderException SchemaException()
    {
        return new HolidayProviderException(
            HolidayProviderFailureKind.SchemaOrDeserialization,
            "The PNLdev response has an unexpected schema.");
    }

    private static HolidayProviderException ValidationException(string message)
    {
        return new HolidayProviderException(HolidayProviderFailureKind.Validation, message);
    }
}
