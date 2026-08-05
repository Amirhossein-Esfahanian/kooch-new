using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IRoomService
{
    Task<OwnerRoomResponse> CreatePropertyRoomAsync(int userId, UserRole role, int propertyId, CreatePropertyRoomRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<OwnerRoomResponse>> GetRoomsByPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
    Task<RoomResponse> CreateRoomAsync(int userId, UserRole role, int roomTypeId, CreateRoomRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomResponse>> GetRoomsByRoomTypeAsync(int userId, UserRole role, int roomTypeId, CancellationToken cancellationToken = default);
}
