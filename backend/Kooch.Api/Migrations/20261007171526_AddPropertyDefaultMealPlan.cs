using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPropertyDefaultMealPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DefaultMealPlanId",
                table: "Properties",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Properties_DefaultMealPlanId",
                table: "Properties",
                column: "DefaultMealPlanId");

            migrationBuilder.AddForeignKey(
                name: "FK_Properties_MealPlans_DefaultMealPlanId",
                table: "Properties",
                column: "DefaultMealPlanId",
                principalTable: "MealPlans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Properties_MealPlans_DefaultMealPlanId",
                table: "Properties");

            migrationBuilder.DropIndex(
                name: "IX_Properties_DefaultMealPlanId",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "DefaultMealPlanId",
                table: "Properties");
        }
    }
}
