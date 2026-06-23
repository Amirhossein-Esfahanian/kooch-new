using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPromotionEngine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Promotions_RoomTypes_RoomTypeId",
                table: "Promotions");

            migrationBuilder.DropIndex(
                name: "IX_Promotions_PropertyId",
                table: "Promotions");

            migrationBuilder.DropIndex(
                name: "IX_Promotions_RoomTypeId",
                table: "Promotions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Promotion_Scope",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "MinimumNights",
                table: "Promotions");

            migrationBuilder.RenameColumn(
                name: "Name",
                table: "Promotions",
                newName: "Title");

            migrationBuilder.RenameColumn(
                name: "DiscountType",
                table: "Promotions",
                newName: "Type");

            migrationBuilder.AddColumn<decimal>(
                name: "Amount",
                table: "Promotions",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InternalDescription",
                table: "Promotions",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastMinuteDays",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Percentage",
                table: "Promotions",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PublicDescription",
                table: "Promotions",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Weekdays",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 127);

            migrationBuilder.CreateTable(
                name: "PromotionRoomTypes",
                columns: table => new
                {
                    PromotionId = table.Column<int>(type: "int", nullable: false),
                    RoomTypeId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PromotionRoomTypes", x => new { x.PromotionId, x.RoomTypeId });
                    table.ForeignKey(
                        name: "FK_PromotionRoomTypes_Promotions_PromotionId",
                        column: x => x.PromotionId,
                        principalTable: "Promotions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PromotionRoomTypes_RoomTypes_RoomTypeId",
                        column: x => x.RoomTypeId,
                        principalTable: "RoomTypes",
                        principalColumn: "Id");
                });

            migrationBuilder.Sql("""
                UPDATE promotion
                SET promotion.PropertyId = room.PropertyId
                FROM Promotions promotion
                INNER JOIN RoomTypes room ON room.Id = promotion.RoomTypeId
                WHERE promotion.PropertyId IS NULL;

                INSERT INTO PromotionRoomTypes (PromotionId, RoomTypeId)
                SELECT promotion.Id, promotion.RoomTypeId
                FROM Promotions promotion
                WHERE promotion.RoomTypeId IS NOT NULL;

                INSERT INTO PromotionRoomTypes (PromotionId, RoomTypeId)
                SELECT promotion.Id, room.Id
                FROM Promotions promotion
                INNER JOIN RoomTypes room ON room.PropertyId = promotion.PropertyId
                WHERE promotion.RoomTypeId IS NULL AND promotion.PropertyId IS NOT NULL;

                UPDATE Promotions SET Percentage = DiscountValue WHERE Type = 0;
                UPDATE Promotions SET Amount = DiscountValue WHERE Type = 1;

                DELETE FROM Promotions WHERE PropertyId IS NULL;
                """);

            migrationBuilder.DropColumn(name: "DiscountValue", table: "Promotions");
            migrationBuilder.DropColumn(name: "Scope", table: "Promotions");
            migrationBuilder.DropColumn(name: "RoomTypeId", table: "Promotions");

            migrationBuilder.AlterColumn<int>(
                name: "PropertyId",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_PropertyId_SortOrder",
                table: "Promotions",
                columns: new[] { "PropertyId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_PromotionRoomTypes_RoomTypeId",
                table: "PromotionRoomTypes",
                column: "RoomTypeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PromotionRoomTypes");

            migrationBuilder.DropIndex(
                name: "IX_Promotions_PropertyId_SortOrder",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "Amount",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "InternalDescription",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "LastMinuteDays",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "Percentage",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "PublicDescription",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "Weekdays",
                table: "Promotions");

            migrationBuilder.RenameColumn(
                name: "Type",
                table: "Promotions",
                newName: "DiscountType");

            migrationBuilder.RenameColumn(
                name: "Title",
                table: "Promotions",
                newName: "Name");

            migrationBuilder.AlterColumn<int>(
                name: "PropertyId",
                table: "Promotions",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<string>(
                name: "Code",
                table: "Promotions",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountValue",
                table: "Promotions",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "MinimumNights",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RoomTypeId",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Scope",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_PropertyId",
                table: "Promotions",
                column: "PropertyId");

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_RoomTypeId",
                table: "Promotions",
                column: "RoomTypeId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Promotion_Scope",
                table: "Promotions",
                sql: "([Scope] = 0 AND [PropertyId] IS NULL AND [RoomTypeId] IS NULL) OR ([Scope] = 1 AND [PropertyId] IS NOT NULL AND [RoomTypeId] IS NULL) OR ([Scope] = 2 AND [PropertyId] IS NULL AND [RoomTypeId] IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_Promotions_RoomTypes_RoomTypeId",
                table: "Promotions",
                column: "RoomTypeId",
                principalTable: "RoomTypes",
                principalColumn: "Id");
        }
    }
}
