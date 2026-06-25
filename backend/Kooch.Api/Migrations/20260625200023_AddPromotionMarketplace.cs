using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPromotionMarketplace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "PropertyId",
                table: "Promotions",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<bool>(
                name: "IsPublished",
                table: "Promotions",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Source",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "SourcePromotionId",
                table: "Promotions",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Promotions_SourcePromotionId_PropertyId",
                table: "Promotions",
                columns: new[] { "SourcePromotionId", "PropertyId" });

            migrationBuilder.AddForeignKey(
                name: "FK_Promotions_Promotions_SourcePromotionId",
                table: "Promotions",
                column: "SourcePromotionId",
                principalTable: "Promotions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Promotions_Promotions_SourcePromotionId",
                table: "Promotions");

            migrationBuilder.DropIndex(
                name: "IX_Promotions_SourcePromotionId_PropertyId",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "IsPublished",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Promotions");

            migrationBuilder.DropColumn(
                name: "SourcePromotionId",
                table: "Promotions");

            migrationBuilder.AlterColumn<int>(
                name: "PropertyId",
                table: "Promotions",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);
        }
    }
}
