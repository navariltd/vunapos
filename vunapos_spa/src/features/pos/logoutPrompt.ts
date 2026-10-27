type LogoutPromptInput = {
  posMode?: "Retail" | "Restaurant";
  canTakePayment?: boolean;
  shiftOpen: boolean;
};

// Restaurant: only users who take payment (VunaPOS Cashier) hold shifts. Retail:
// every POS user works in a shift, so an open shift alone is enough.
export function shiftCheckNeeded({ posMode, canTakePayment }: Omit<LogoutPromptInput, "shiftOpen">) {
  return posMode !== "Restaurant" || Boolean(canTakePayment);
}

// Logging out leaves the shift open, so ask first.
export function shouldConfirmLogout(input: LogoutPromptInput) {
  return input.shiftOpen && shiftCheckNeeded(input);
}
