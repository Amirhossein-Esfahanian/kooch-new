using Kooch.Api.Dtos.Properties;

namespace Kooch.Api.Exceptions;

public class PropertyActivationException(PropertyCompletionResponse completion)
    : InvalidOperationException("اطلاعات اقامتگاه برای فعال‌سازی کامل نیست.")
{
    public PropertyCompletionResponse Completion { get; } = completion;
}
