using Kooch.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(KoochDbContext))]
    [Migration("20260716090000_FixRoomDailyPriceHistoryPropertyIds")]
    public partial class FixRoomDailyPriceHistoryPropertyIds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                IF EXISTS (
                    SELECT 1
                    FROM RoomDailyPriceHistory AS history
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM RoomTypes AS roomType
                        WHERE roomType.Id = history.RoomTypeId
                          AND roomType.IsDeleted = 0
                    )
                )
                BEGIN
                    THROW 51020, 'RoomDailyPriceHistory property correction failed: a history row references a missing or deleted RoomType.', 1;
                END;

                IF EXISTS (
                    SELECT 1
                    FROM RoomDailyPriceHistory AS history
                    INNER JOIN RoomTypes AS roomType ON roomType.Id = history.RoomTypeId
                    WHERE history.PropertyId <> roomType.PropertyId
                      AND NOT EXISTS (
                          SELECT 1
                          FROM Properties AS property
                          WHERE property.Id = roomType.PropertyId
                            AND property.IsDeleted = 0
                      )
                )
                BEGIN
                    THROW 51021, 'RoomDailyPriceHistory property correction failed: a canonical RoomType.PropertyId references a missing or deleted Property.', 1;
                END;

                DECLARE @AffectedRows nvarchar(max);

                SELECT @AffectedRows = STRING_AGG(
                    CONVERT(nvarchar(max), CONCAT(
                        'HistoryId=', history.Id,
                        ', RoomTypeId=', history.RoomTypeId,
                        ', PropertyId=', history.PropertyId,
                        ' -> ',
                        roomType.PropertyId
                    )),
                    '; '
                )
                FROM RoomDailyPriceHistory AS history
                INNER JOIN RoomTypes AS roomType ON roomType.Id = history.RoomTypeId
                WHERE history.PropertyId <> roomType.PropertyId;

                IF @AffectedRows IS NOT NULL
                BEGIN
                    PRINT CONCAT('RoomDailyPriceHistory property id corrections: ', @AffectedRows);
                END
                ELSE
                BEGIN
                    PRINT 'RoomDailyPriceHistory property id corrections: no rows required correction.';
                END;

                UPDATE history
                SET PropertyId = roomType.PropertyId
                FROM RoomDailyPriceHistory AS history
                INNER JOIN RoomTypes AS roomType ON roomType.Id = history.RoomTypeId
                WHERE history.PropertyId <> roomType.PropertyId;

                PRINT CONCAT('RoomDailyPriceHistory property id correction affected rows: ', @@ROWCOUNT);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                THROW 51022, 'FixRoomDailyPriceHistoryPropertyIds is an irreversible data correction. Restore affected PropertyId values from backup if rollback is required.', 1;
                """);
        }
    }
}
