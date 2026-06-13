using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IRoomTypeService
{
    Task<RoomTypeResponse> CreateRoomTypeAsync(int userId, UserRole role, int propertyId, CreateRoomTypeRequest request, CancellationToken cancellationToken = default);
    Task<RoomTypeResponse> UpdateRoomTypeAsync(int userId, UserRole role, int roomTypeId, UpdateRoomTypeRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RoomTypeResponse>> GetRoomTypesByPropertyAsync(int userId, UserRole role, int propertyId, CancellationToken cancellationToken = default);
}
