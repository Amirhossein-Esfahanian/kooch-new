using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPropertyAccessibilityAndRoomTypeAmenities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HasAccessibleBathroom",
                table: "Properties",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasGroundFloorRoom",
                table: "Properties",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsWheelchairAccessible",
                table: "Properties",
                type: "bit",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HasAccessibleBathroom",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "HasGroundFloorRoom",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "IsWheelchairAccessible",
                table: "Properties");
        }
    }
}
