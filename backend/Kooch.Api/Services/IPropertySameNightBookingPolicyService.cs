using Kooch.Api.Entities;

namespace Kooch.Api.Services;

public interface IPropertySameNightBookingPolicyService
{
    SameNightBookingPolicyResult Evaluate(Property property, DateOnly requestedCheckIn);
}
