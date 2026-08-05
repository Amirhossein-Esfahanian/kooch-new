using Kooch.Api.Entities;

namespace Kooch.Api.Catalogs;

internal static class RoomKindCatalog
{
    public static readonly IReadOnlyList<RoomKindCatalogEntry> Entries =
    [
        new(RoomKind.Single, "single", "سینگل", "Single", 10),
        new(RoomKind.Double, "double", "دابل", "Double", 20),
        new(RoomKind.Twin, "twin", "تویین", "Twin", 30),
        new(RoomKind.Triple, "triple", "تریپل", "Triple", 40),
        new(RoomKind.Quad, "quad", "کواد", "Quad", 50),
        new(RoomKind.Family, "family", "خانوادگی", "Family", 60),
        new(RoomKind.Suite, "suite", "سوئیت", "Suite", 70),
        new(RoomKind.JuniorSuite, "junior-suite", "جونیور سوئیت", "Junior Suite", 80),
        new(RoomKind.Apartment, "apartment", "آپارتمان", "Apartment", 90),
        new(RoomKind.Villa, "villa", "ویلا", "Villa", 100),
        new(RoomKind.Dormitory, "dormitory", "خوابگاه", "Dormitory", 110),
        new(RoomKind.Other, "other", "سایر", "Other", 120)
    ];
}

internal sealed record RoomKindCatalogEntry(
    RoomKind Value,
    string Code,
    string TitleFa,
    string TitleEn,
    int DisplayOrder);
