using Kooch.Api.Dtos.Guests;

namespace Kooch.Api.Services;

public interface IGuestService
{
    Task<GuestResponse> GetAsync(int id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<GuestResponse>> SearchAsync(GuestSearchRequest query, CancellationToken cancellationToken = default);
    Task<GuestResponse> CreateAsync(GuestCreateRequest request, CancellationToken cancellationToken = default);
    Task<GuestResponse> UpdateAsync(int id, GuestUpdateRequest request, CancellationToken cancellationToken = default);
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
