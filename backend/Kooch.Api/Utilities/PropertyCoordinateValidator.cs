namespace Kooch.Api.Utilities;

public static class PropertyCoordinateValidator
{
    public static string? GetValidationError(decimal? latitude, decimal? longitude)
    {
        if (latitude.HasValue != longitude.HasValue)
        {
            return "Latitude and longitude must either both be supplied or both be omitted.";
        }

        if (latitude is < -90 or > 90)
        {
            return "Latitude must be between -90 and 90.";
        }

        if (longitude is < -180 or > 180)
        {
            return "Longitude must be between -180 and 180.";
        }

        return null;
    }

    public static void EnsureValid(decimal? latitude, decimal? longitude)
    {
        var validationError = GetValidationError(latitude, longitude);
        if (validationError is not null)
        {
            throw new ArgumentException(validationError);
        }
    }
}
