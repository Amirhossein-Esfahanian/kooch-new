using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRoomDetailsAndImprovePropertyImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PropertyImages_PropertyId",
                table: "PropertyImages");

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "Rooms",
                type: "nvarchar(3000)",
                maxLength: 3000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FloorNumber",
                table: "Rooms",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasPrivateBathroom",
                table: "Rooms",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasWindow",
                table: "Rooms",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Rooms",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "StairCount",
                table: "Rooms",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Caption",
                table: "PropertyImages",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsGallery",
                table: "PropertyImages",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<int>(
                name: "RoomId",
                table: "PropertyImages",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RoomTypeId",
                table: "PropertyImages",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Tag",
                table: "PropertyImages",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PropertyImages_PropertyId_Tag",
                table: "PropertyImages",
                columns: new[] { "PropertyId", "Tag" });

            migrationBuilder.CreateIndex(
                name: "IX_PropertyImages_RoomId",
                table: "PropertyImages",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_PropertyImages_RoomTypeId",
                table: "PropertyImages",
                column: "RoomTypeId");

            migrationBuilder.AddForeignKey(
                name: "FK_PropertyImages_RoomTypes_RoomTypeId",
                table: "PropertyImages",
                column: "RoomTypeId",
                principalTable: "RoomTypes",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PropertyImages_Rooms_RoomId",
                table: "PropertyImages",
                column: "RoomId",
                principalTable: "Rooms",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PropertyImages_RoomTypes_RoomTypeId",
                table: "PropertyImages");

            migrationBuilder.DropForeignKey(
                name: "FK_PropertyImages_Rooms_RoomId",
                table: "PropertyImages");

            migrationBuilder.DropIndex(
                name: "IX_PropertyImages_PropertyId_Tag",
                table: "PropertyImages");

            migrationBuilder.DropIndex(
                name: "IX_PropertyImages_RoomId",
                table: "PropertyImages");

            migrationBuilder.DropIndex(
                name: "IX_PropertyImages_RoomTypeId",
                table: "PropertyImages");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "FloorNumber",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "HasPrivateBathroom",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "HasWindow",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "StairCount",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "Caption",
                table: "PropertyImages");

            migrationBuilder.DropColumn(
                name: "IsGallery",
                table: "PropertyImages");

            migrationBuilder.DropColumn(
                name: "RoomId",
                table: "PropertyImages");

            migrationBuilder.DropColumn(
                name: "RoomTypeId",
                table: "PropertyImages");

            migrationBuilder.DropColumn(
                name: "Tag",
                table: "PropertyImages");

            migrationBuilder.CreateIndex(
                name: "IX_PropertyImages_PropertyId",
                table: "PropertyImages",
                column: "PropertyId");
        }
    }
}
