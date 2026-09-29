using System.Globalization;
using Kooch.Api.Services.MediaStorage;

namespace Kooch.Api.Services.ProfileAvatar;

public sealed class FileSystemProfileAvatarStorage(IMediaStorage mediaStorage) : IProfileAvatarStorage
{
    private string DirectoryPath
    {
        get
        {
            mediaStorage.Initialize();
            // The media root is publicly served. Keep deterministic avatars in a sibling private root.
            return Path.Combine($"{mediaStorage.RootPath}-private", "avatars");
        }
    }

    private string PathFor(int userId)
    {
        if (userId <= 0) throw new ArgumentOutOfRangeException(nameof(userId));
        return Path.Combine(DirectoryPath, $"{userId.ToString(CultureInfo.InvariantCulture)}.webp");
    }

    public async Task<byte[]?> ReadAsync(int userId, CancellationToken cancellationToken = default)
    {
        var path = PathFor(userId);
        try { return await File.ReadAllBytesAsync(path, cancellationToken); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    public async Task WriteAsync(int userId, ReadOnlyMemory<byte> webp, CancellationToken cancellationToken = default)
    {
        var path = PathFor(userId);
        Directory.CreateDirectory(DirectoryPath);
        var temporaryPath = Path.Combine(DirectoryPath, $".{Guid.NewGuid():N}.tmp");
        try
        {
            await File.WriteAllBytesAsync(temporaryPath, webp.ToArray(), cancellationToken);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    public Task DeleteAsync(int userId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = PathFor(userId);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }
}
