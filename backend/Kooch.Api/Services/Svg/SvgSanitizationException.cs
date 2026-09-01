namespace Kooch.Api.Services.Svg;

public sealed class SvgSanitizationException : Exception
{
    public SvgSanitizationException(
        SvgSanitizationFailure failure,
        string message,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Failure = failure;
    }

    public SvgSanitizationFailure Failure { get; }
}
