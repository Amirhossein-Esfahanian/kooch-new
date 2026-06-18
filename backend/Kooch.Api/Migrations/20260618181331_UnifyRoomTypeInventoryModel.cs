using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class UnifyRoomTypeInventoryModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FloorNumber",
                table: "RoomTypes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasPrivateBathroom",
                table: "RoomTypes",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasWindow",
                table: "RoomTypes",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "RoomTypes",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "StairCount",
                table: "RoomTypes",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FloorNumber",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "HasPrivateBathroom",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "HasWindow",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "StairCount",
                table: "RoomTypes");
        }
    }
}
