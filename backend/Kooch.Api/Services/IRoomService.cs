using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IRoomService
{
    Task<RoomResponse> CreateRoomAsync(int userId, UserRole role, int roomTypeId, CreateRoomRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomResponse>> GetRoomsByRoomTypeAsync(int userId, UserRole role, int roomTypeId, CancellationToken cancellationToken = default);
}
