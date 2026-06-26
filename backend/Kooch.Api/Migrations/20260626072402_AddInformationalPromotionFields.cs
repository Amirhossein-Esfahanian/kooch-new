using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInformationalPromotionFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BadgeColor",
                table: "Promotions",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinimumGuests",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinimumStayNights",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OptionalIcon",
                table: "Promotions",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BadgeColor",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "MinimumGuests",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "MinimumStayNights",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "OptionalIcon",
                table: "Promotions");
        }
    }
}
