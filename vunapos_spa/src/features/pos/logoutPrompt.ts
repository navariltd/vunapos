import { needsRestaurantShift } from "../restaurant/restaurantRoles";

type LogoutPromptInput = {
  posMode?: "Retail" | "Restaurant";
  canTakePayment?: boolean;
  restaurantRoles?: string[];
  canManageRestaurant?: boolean;
  shiftOpen: boolean;
};

// Selling users own shifts in either mode; kitchen-only users are exempt.
export function shiftCheckNeeded({ posMode, canTakePayment, restaurantRoles, canManageRestaurant }: Omit<LogoutPromptInput, "shiftOpen">) {
  return posMode !== "Restaurant" || needsRestaurantShift(restaurantRoles, canTakePayment, canManageRestaurant);
}

// Logging out leaves the shift open, so ask first.
export function shouldConfirmLogout(input: LogoutPromptInput) {
  return input.shiftOpen && shiftCheckNeeded(input);
}
