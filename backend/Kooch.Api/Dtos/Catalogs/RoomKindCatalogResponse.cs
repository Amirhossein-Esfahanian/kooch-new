namespace Kooch.Api.Dtos.Catalogs;

public sealed record RoomKindCatalogResponse(
    int Value,
    string Code,
    string TitleFa,
    string TitleEn,
    int DisplayOrder);
