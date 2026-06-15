using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class StabilizePropertyWizardDataModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EnglishName",
                table: "RoomTypes",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnglishName",
                table: "Rooms",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnglishName",
                table: "Properties",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE [Properties]
                SET [Slug] = CASE
                    WHEN [Slug] COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Za-z0-9-]%'
                        OR LTRIM(RTRIM([Slug])) = ''
                    THEN CONCAT('property-', [Id])
                    ELSE LOWER([Slug])
                END;

                UPDATE [RoomTypes]
                SET [Slug] = CASE
                    WHEN [Slug] COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Za-z0-9-]%'
                        OR LTRIM(RTRIM([Slug])) = ''
                    THEN CONCAT('room-type-', [Id])
                    ELSE LOWER([Slug])
                END;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EnglishName",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "EnglishName",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "EnglishName",
                table: "Properties");
        }
    }
}
