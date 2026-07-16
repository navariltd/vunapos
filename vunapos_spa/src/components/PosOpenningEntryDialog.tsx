import { AlertCircle, Banknote, CheckCircle2, CreditCard, Wallet, X } from "lucide-react";
import React, { useMemo,useEffect, useState } from "react";
import { useCreatePOSOpeningEntry } from "../services/openingEntry";
import type { ModeOfPaymentDTO } from "../features/pos/types";
import { usePOSProfileStore } from "../store/posProfileStore";

type PaymentMethod = ModeOfPaymentDTO & {
  type: "Cash" | "Bank" | "General";
};

interface POSOpeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const POSOpeningModal: React.FC<POSOpeningModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<"form" | "creating" | "success">("form");
  const [error, setError] = useState("");
const [openingAmounts, setOpeningAmounts] = useState<Record<string, string>>({});  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  const {
    posDetails,
    userInfo,
    posProfiles,
    fetchPOSDetails,
    fetchPOSProfiles,
    // isLoadingProfiles,
  } = usePOSProfileStore();

 const {
  createOpeningEntry,
  isCreating,
  error: createError,
  // success,
} = useCreatePOSOpeningEntry();


  /**
   * Load POS data when modal opens
   */
 useEffect(() => {
  if (!isOpen) return;


  // Enable POS API calls
  usePOSProfileStore
    .getState()
    .setAuthenticated(true);


  const loadPOSData = async () => {

    await Promise.all([
      fetchPOSDetails(true),
      fetchPOSProfiles(true),
    ]);

  };


  loadPOSData();

}, [isOpen]);


  /**
   * Resolve active profile
   */
const activePosProfile =
  posProfiles.find(p => p.is_default)?.name ??
  posDetails?.name ??
  userInfo?.pos_profile_name ??
  null;

  /**
   * Build dropdown profiles
   */


useEffect(() => {
  console.log("Loaded profiles:", posProfiles);
}, [posProfiles]);
const profileOptions = useMemo(() => {
  return posProfiles
    .filter((profile) => profile?.name)
    .map((profile) => ({
      label: profile.name,
      value: profile.name,
    }));
}, [posProfiles]);
  /**
   * Set default selected profile after loading
   */
useEffect(() => {
  if (!selectedProfile && profileOptions.length > 0) {
    setSelectedProfile(
      activePosProfile ?? profileOptions[0].value
    );
  }
}, [
  profileOptions,
  activePosProfile,
  selectedProfile
]);

  const posProfile =
    selectedProfile ??
    activePosProfile ??
    null;

const selectedPOSProfile = useMemo(() => {
  return posProfiles.find(
    (profile) => profile.name === posProfile
  );
}, [posProfiles, posProfile]);

 const paymentMethods = useMemo<PaymentMethod[]>(() => {

  const modes = selectedPOSProfile?.modes_of_payment ?? [];

  return modes.map((mode) => {

    const name = mode.mode_of_payment.toLowerCase();

    return {
      ...mode,
      type:
        name.includes("cash")
          ? "Cash"
          : name.includes("bank")
          ? "Bank"
          : "General",
    };

  });

}, [selectedPOSProfile]);

  const getPaymentIcon = (type: PaymentMethod["type"]) => {
    switch (type) {
      case "Cash":
        return <Banknote className="h-5 w-5 text-green-600" />;
      case "Bank":
        return <CreditCard className="h-5 w-5 text-blue-600" />;
      default:
        return <Wallet className="h-5 w-5 text-gray-600" />;
    }
  };

const updatePaymentAmount = (
  modeOfPayment: string,
  amount: string
) => {
  setOpeningAmounts((previous) => ({
    ...previous,
    [modeOfPayment]: amount,
  }));
};

const handleCreateOpeningEntry = async () => {
  if (!posProfile) {
    setError(
      "No POS Profile is assigned to your account. Please contact your administrator."
    );
    return;
  }

  if (!paymentMethods.length) {
    setError(
      "No payment modes are configured for this POS Profile."
    );
    return;
  }

  try {
    setError("");
    setStep("creating");

   const openingBalance = paymentMethods.map((method) => ({
  mode_of_payment: method.mode_of_payment,
  opening_amount: Number(
    openingAmounts[method.mode_of_payment] || 0
  ),
}));

    console.log("Creating POS Opening Entry:", {
      pos_profile: posProfile,
      opening_balance: openingBalance,
    });


 const response = await createOpeningEntry(
  openingBalance,
  posProfile
);

if (response) {
  setStep("success");

  window.setTimeout(() => {
    onSuccess?.();
    onClose();
  }, 1000);
}


    





  } catch (err) {

    setError(
      err instanceof Error
        ? err.message
        : "Failed to create POS opening entry"
    );

    setStep("form");
  }
};
useEffect(() => {

  if (!paymentMethods.length) return;


  setOpeningAmounts((current) => {

    const amounts = { ...current };


   paymentMethods.forEach((mode) => {
  if (amounts[mode.mode_of_payment] === undefined) {
    amounts[mode.mode_of_payment] = "";
  }
});


    return amounts;

  });


}, [paymentMethods]);
  useEffect(() => {
  if (activePosProfile && !selectedProfile) {
    setSelectedProfile(activePosProfile);
  }
}, [activePosProfile, selectedProfile]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
        <div className="flex justify-between bg-beveren-600 px-6 py-4 text-white">
          <h2 className="font-semibold">POS Opening Entry</h2>
          <button type="button" onClick={onClose} aria-label="Close POS opening entry">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {step === "form" && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium">POS Profile</label>
                {profileOptions.length ? (
            <select
  value={selectedProfile ?? ""}
  onChange={(event) => {
    setSelectedProfile(event.target.value || null);
    setError("");
  }}
  className="w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-700"
>
  {profileOptions.map((profile) => (
    <option 
      key={profile.value} 
      value={profile.value}
    >
      {profile.label}
    </option>
  ))}
</select>
                ) : (
                  <div className="w-full rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    No POS Profile assigned
                  </div>
                )}
              </div>

              <div>
                <label className="mb-3 block text-sm font-medium">Opening Balances</label>
                <div className="space-y-3">
                  {paymentMethods.map((method) => (
                    <div key={method.mode_of_payment} className="flex items-center gap-3 rounded bg-gray-50 p-3">
                      {getPaymentIcon(method.type)}
                      <div className="flex-1">
                        <p className="font-medium">{method.mode_of_payment}</p>
                        <p className="text-xs text-gray-500">{method.type}</p>
                      </div>
                   <input
  type="number"
  min="0"
  placeholder="0.00"
  value={openingAmounts[method.mode_of_payment] ?? ""}
  onChange={(event) =>
    updatePaymentAmount(
      method.mode_of_payment,
      event.target.value
    )
  }
  className="w-24 rounded border px-2 py-1"
/>
                    </div>
                  ))}
                  {!paymentMethods.length && (
                    <p className="rounded bg-gray-50 p-3 text-sm text-gray-500">Loading configured payment modes…</p>
                  )}
                </div>
              </div>

              {(error || createError) && (
                <div className="flex gap-2 rounded bg-red-50 p-3 text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error || createError}
                </div>
              )}

            <div className="flex justify-end gap-3">
  <button
    type="button"
    onClick={onClose}
    className="rounded border px-4 py-2"
  >
    Cancel
  </button>

<button
  type="button"
  onClick={handleCreateOpeningEntry}
  disabled={
    !posProfile ||
    paymentMethods.length === 0 ||
    isCreating
  }
  className="rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
>
  {isCreating ? "Starting..." : "Start POS Session"}
</button>
</div>
            </div>
          )}

          {step === "creating" && <div className="py-10 text-center">Creating POS Session...</div>}

          {step === "success" && (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
              <h3 className="mt-3 font-semibold">POS Session Started</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default POSOpeningModal;
