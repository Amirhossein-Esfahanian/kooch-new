namespace Kooch.Api.Services.Svg;

public enum SvgSanitizationFailure
{
    EmptyInput = 1,
    TooLarge = 2,
    InvalidXml = 3,
    UnsupportedStructure = 4,
    UnsafeContent = 5
}
