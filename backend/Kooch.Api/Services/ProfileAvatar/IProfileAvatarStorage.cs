namespace Kooch.Api.Services.ProfileAvatar;

public interface IProfileAvatarStorage
{
    Task<byte[]?> ReadAsync(int userId, CancellationToken cancellationToken = default);
    Task WriteAsync(int userId, ReadOnlyMemory<byte> webp, CancellationToken cancellationToken = default);
    Task DeleteAsync(int userId, CancellationToken cancellationToken = default);
}
