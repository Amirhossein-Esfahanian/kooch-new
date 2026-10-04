using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationRatePlanSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MealPlanNameSnapshot",
                table: "Reservations",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MealPlanSlugSnapshot",
                table: "Reservations",
                type: "nvarchar(170)",
                maxLength: 170,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatePlanNameSnapshot",
                table: "Reservations",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RatePlanPriceModifierTypeSnapshot",
                table: "Reservations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "RatePlanPriceModifierValueSnapshot",
                table: "Reservations",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MealPlanNameSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "MealPlanSlugSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RatePlanNameSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RatePlanPriceModifierTypeSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "RatePlanPriceModifierValueSnapshot",
                table: "Reservations");
        }
    }
}
