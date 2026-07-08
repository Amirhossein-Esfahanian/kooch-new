using Microsoft.Extensions.Logging;

namespace Kooch.Api.Services;

public class NoOpEmailSender(ILogger<NoOpEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string email, string? subject, string message, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Email notification logged only for {Email}.", email);
        return Task.CompletedTask;
    }
}
