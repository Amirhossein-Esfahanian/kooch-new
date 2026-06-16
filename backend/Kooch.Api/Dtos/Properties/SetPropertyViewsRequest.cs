using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Properties;

public class SetPropertyViewsRequest
{
    public IReadOnlyList<PropertyViewType> Views { get; set; } = [];
}

public class PropertyViewResponse
{
    public PropertyViewType ViewType { get; set; }
}
