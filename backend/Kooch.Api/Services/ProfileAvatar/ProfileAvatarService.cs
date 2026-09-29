using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace Kooch.Api.Services.ProfileAvatar;

public sealed class ProfileAvatarService(IProfileAvatarStorage storage)
{
    public const long MaximumUploadBytes = 5 * 1024 * 1024;
    private const int OutputSize = 512;
    private const long MaximumDecodedPixels = 50_000_000;

    public Task<byte[]?> ReadAsync(int userId, CancellationToken cancellationToken = default) =>
        storage.ReadAsync(userId, cancellationToken);

    public Task DeleteAsync(int userId, CancellationToken cancellationToken = default) =>
        storage.DeleteAsync(userId, cancellationToken);

    public async Task UploadAsync(int userId, IFormFile file, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(file);
        if (file.Length is <= 0 or > MaximumUploadBytes)
            throw new ArgumentException("Avatar image must be nonempty and 5 MB or smaller.", nameof(file));

        try
        {
            await using var input = file.OpenReadStream();
            var info = await Image.IdentifyAsync(input, cancellationToken)
                ?? throw new ArgumentException("Uploaded content is not an image.", nameof(file));
            var format = info.Metadata.DecodedImageFormat?.Name;
            if (!(string.Equals(format, "JPEG", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(format, "PNG", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(format, "WEBP", StringComparison.OrdinalIgnoreCase)) ||
                info.Width <= 0 || info.Height <= 0 || (long)info.Width * info.Height > MaximumDecodedPixels)
                throw new ArgumentException("Avatar must be a supported JPEG, PNG or WebP image.", nameof(file));

            await using var decodedInput = file.OpenReadStream();
            using var image = await Image.LoadAsync(decodedInput, cancellationToken);
            image.Mutate(operation => operation.AutoOrient().Resize(new ResizeOptions
            {
                Size = new Size(OutputSize, OutputSize), Mode = ResizeMode.Crop, Position = AnchorPositionMode.Center
            }));
            await using var output = new MemoryStream();
            await image.SaveAsWebpAsync(output, new WebpEncoder { Quality = 85 }, cancellationToken);
            await storage.WriteAsync(userId, output.ToArray(), cancellationToken);
        }
        catch (UnknownImageFormatException exception)
        {
            throw new ArgumentException("Uploaded content is not a supported image.", nameof(file), exception);
        }
        catch (InvalidImageContentException exception)
        {
            throw new ArgumentException("Uploaded image is malformed.", nameof(file), exception);
        }
    }
}
