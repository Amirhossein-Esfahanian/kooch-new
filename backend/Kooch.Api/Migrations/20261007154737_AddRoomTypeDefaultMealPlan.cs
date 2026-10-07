using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRoomTypeDefaultMealPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DefaultMealPlanId",
                table: "RoomTypes",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RoomTypes_DefaultMealPlanId",
                table: "RoomTypes",
                column: "DefaultMealPlanId");

            migrationBuilder.AddForeignKey(
                name: "FK_RoomTypes_MealPlans_DefaultMealPlanId",
                table: "RoomTypes",
                column: "DefaultMealPlanId",
                principalTable: "MealPlans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RoomTypes_MealPlans_DefaultMealPlanId",
                table: "RoomTypes");

            migrationBuilder.DropIndex(
                name: "IX_RoomTypes_DefaultMealPlanId",
                table: "RoomTypes");

            migrationBuilder.DropColumn(
                name: "DefaultMealPlanId",
                table: "RoomTypes");
        }
    }
}
