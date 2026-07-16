import { useState } from "react";

interface OpeningBalance {
  mode_of_payment: string;
  opening_amount: number;
}

interface OpeningEntryResponse {
  success: boolean;
  name: string;
  status?: string;
  opening_entry?: string;
  message?: string;
}

interface UseCreateOpeningReturn {
  createOpeningEntry: (
    openingBalance: OpeningBalance[],
    posProfile?: string
  ) => Promise<OpeningEntryResponse | null>;

  isCreating: boolean;
  error: string | null;
  success: boolean;
}

export function useCreatePOSOpeningEntry(): UseCreateOpeningReturn {

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);


  const createOpeningEntry = async (
    openingBalance: OpeningBalance[],
    posProfile?: string
  ): Promise<OpeningEntryResponse | null> => {

    setIsCreating(true);
    setError(null);
    setSuccess(false);

    const csrfToken = window.csrf_token;

    try {

      const res = await fetch(
        "/api/method/vunapos.api.pos_entry.create_opening_entry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken && {
              "X-Frappe-CSRF-Token": csrfToken,
            }),
          },
          credentials: "include",
          body: JSON.stringify({
            opening_balance: openingBalance,
            pos_profile: posProfile,
          }),
        }
      );


      const data = await res.json();


      if (!res.ok) {
        throw new Error(
          data.message ||
          data._server_messages ||
          "Failed to create opening entry"
        );
      }


      setSuccess(true);


      return data.message ?? null;


    } catch (err: unknown) {

      console.error(
        "Error creating POS Opening Entry:",
        err
      );


      const message =
        err instanceof Error
          ? err.message
          : "Unexpected error occurred";


      setError(message);


      throw err;


    } finally {

      setIsCreating(false);

    }
  };


  return {
    createOpeningEntry,
    isCreating,
    error,
    success,
  };
}