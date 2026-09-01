namespace Kooch.Api.Services.MediaStorage;

public sealed class MediaStagingException : Exception
{
    public MediaStagingException(MediaStagingFailure failure, string message)
        : base(message)
    {
        Failure = failure;
    }

    public MediaStagingFailure Failure { get; }
}
