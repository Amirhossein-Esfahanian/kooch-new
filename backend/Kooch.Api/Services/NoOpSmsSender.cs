using Microsoft.Extensions.Logging;

namespace Kooch.Api.Services;

public class NoOpSmsSender(ILogger<NoOpSmsSender> logger) : ISmsSender
{
    public Task SendAsync(string mobile, string message, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("SMS notification logged only for {Mobile}.", mobile);
        return Task.CompletedTask;
    }
}
