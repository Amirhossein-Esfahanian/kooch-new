namespace Kooch.Api.Services.Amenities;

public enum IconWriteAction
{
    Preserve,
    Replace,
    Remove
}

public static class IconWriteRequestValidator
{
    private const string InvalidRequestMessage = "درخواست تغییر آیکن نامعتبر است.";
    public static IconWriteAction ValidateCreate(
        string? uploadToken,
        bool removeIcon)
    {
        if (removeIcon)
        {
            throw new ArgumentException(InvalidRequestMessage);
        }

        return uploadToken is null ? IconWriteAction.Preserve : IconWriteAction.Replace;
    }

    public static IconWriteAction ValidateUpdate(
        string? uploadToken,
        bool removeIcon)
    {
        if (removeIcon)
        {
            if (uploadToken is not null)
            {
                throw new ArgumentException(InvalidRequestMessage);
            }

            return IconWriteAction.Remove;
        }

        if (uploadToken is not null)
        {
            return IconWriteAction.Replace;
        }

        return IconWriteAction.Preserve;
    }
}
