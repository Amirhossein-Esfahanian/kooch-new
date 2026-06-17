using Kooch.Api.Dtos.Properties;

namespace Kooch.Api.Dtos.Admin;

public class AdminDashboardResponse
{
    public int TotalProperties { get; set; }
    public int PendingProperties { get; set; }
    public int ApprovedProperties { get; set; }
    public int TotalUsers { get; set; }
    public int TotalOwners { get; set; }
    public IReadOnlyList<PropertyResponse> PendingPropertyItems { get; set; } = [];
}
