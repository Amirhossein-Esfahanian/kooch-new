namespace Kooch.Api.Services;

public interface INotificationService
{
    Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default);
}
