namespace Kooch.Api.Services.MediaStorage;

public enum MediaStagingFailure
{
    InvalidToken = 1,
    TokenNotFound = 2,
    TokenExpired = 3,
    NamespaceMismatch = 4
}
