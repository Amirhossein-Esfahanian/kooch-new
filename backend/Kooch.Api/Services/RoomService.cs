using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class RoomService(
    KoochDbContext dbContext,
    IPropertyAccessService propertyAccessService) : IRoomService
{
    public async Task<RoomResponse> CreateRoomAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CreateRoomRequest request,
        CancellationToken cancellationToken = default)
    {
        var roomType = await GetRoomTypeAsync(roomTypeId, cancellationToken);
        if (!await propertyAccessService.CanManageRoomsAsync(
                userId, role, roomType.PropertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot manage rooms for this property.");
        }

        var name = request.Name.Trim();
        if (await dbContext.Rooms.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(room => room.RoomTypeId == roomTypeId && room.Name == name, cancellationToken))
        {
            throw new InvalidOperationException("A room with this name already exists for the room type.");
        }

        var room = new Room
        {
            RoomTypeId = roomTypeId,
            Name = name,
            IsActive = true
        };

        dbContext.Rooms.Add(room);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Map(room);
    }

    public async Task<IReadOnlyList<RoomResponse>> GetRoomsByRoomTypeAsync(
        int userId,
        UserRole role,
        int roomTypeId,
        CancellationToken cancellationToken = default)
    {
        var roomType = await GetRoomTypeAsync(roomTypeId, cancellationToken);
        if (!await propertyAccessService.CanViewAsync(userId, role, roomType.PropertyId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot access this property.");
        }

        return await dbContext.Rooms.AsNoTracking()
            .Where(room => room.RoomTypeId == roomTypeId)
            .OrderBy(room => room.Name)
            .Select(room => new RoomResponse
            {
                Id = room.Id,
                RoomTypeId = room.RoomTypeId,
                Name = room.Name,
                IsActive = room.IsActive
            })
            .ToListAsync(cancellationToken);
    }

    private async Task<RoomType> GetRoomTypeAsync(int roomTypeId, CancellationToken cancellationToken) =>
        await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(roomType => roomType.Id == roomTypeId, cancellationToken)
        ?? throw new KeyNotFoundException("Room type not found.");

    private static RoomResponse Map(Room room) => new()
    {
        Id = room.Id,
        RoomTypeId = room.RoomTypeId,
        Name = room.Name,
        IsActive = room.IsActive
    };
}
