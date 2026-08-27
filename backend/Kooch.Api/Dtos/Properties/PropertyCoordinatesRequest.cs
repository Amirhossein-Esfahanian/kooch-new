using System.ComponentModel.DataAnnotations;
using Kooch.Api.Utilities;

namespace Kooch.Api.Dtos.Properties;

public abstract class PropertyCoordinatesRequest : IValidatableObject
{
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        var validationError = PropertyCoordinateValidator.GetValidationError(Latitude, Longitude);
        if (validationError is not null)
        {
            yield return new ValidationResult(
                validationError,
                [nameof(Latitude), nameof(Longitude)]);
        }
    }
}
