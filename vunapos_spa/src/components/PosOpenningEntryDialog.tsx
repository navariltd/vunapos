import { AlertCircle, Banknote, CheckCircle2, CreditCard, Wallet, X } from "lucide-react";
import React, { useEffect, useState } from "react";

interface PaymentMethod {
  mode_of_payment: string;
  opening_amount: number;
  type: "Cash" | "Bank" | "General";
}

interface POSOpeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  {
    mode_of_payment: "Cash",
    opening_amount: 0,
    type: "Cash",
  },
  {
    mode_of_payment: "Bank",
    opening_amount: 0,
    type: "Bank",
  },
  {
    mode_of_payment: "M-Pesa",
    opening_amount: 0,
    type: "General",
  },
];

const POSOpeningModal: React.FC<POSOpeningModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<"form" | "creating" | "success">("form");
  const [selectedProfile, setSelectedProfile] = useState("Default POS");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setStep("form");
      setError("");
      setPaymentMethods(MOCK_PAYMENT_METHODS);
    }
  }, [isOpen]);


  const getPaymentIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "cash":
        return <Banknote className="w-5 h-5 text-green-600" />;

      case "bank":
        return <CreditCard className="w-5 h-5 text-blue-600" />;

      default:
        return <Wallet className="w-5 h-5 text-gray-600" />;
    }
  };


  const updatePaymentAmount = (index: number, amount: number) => {
    setPaymentMethods((prev) =>
      prev.map((method, i) =>
        i === index
          ? { ...method, opening_amount: amount }
          : method
      )
    );
  };


  const handleCreateOpeningEntry = async () => {
    try {
      setStep("creating");

      // TODO: Replace with API call later
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setStep("success");

      setTimeout(() => {
        onSuccess?.();
      }, 1000);

    } catch (error) {
      setError("Failed to create POS opening entry");
      setStep("form");
    }
  };


  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full">

        <div className="bg-beveren-600 text-white px-6 py-4 flex justify-between">
          <h2 className="font-semibold">
            POS Opening Entry
          </h2>

          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>


        <div className="p-6">

          {step === "form" && (
            <div className="space-y-6">

              <div>
                <label className="block text-sm font-medium mb-2">
                  POS Profile
                </label>

                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="w-full border rounded-md px-3 py-2"
                >
                  <option>
                    Default POS
                  </option>
                </select>
              </div>


              <div>
                <label className="block text-sm font-medium mb-3">
                  Opening Balances
                </label>

                <div className="space-y-3">

                  {paymentMethods.map((method, index) => (
                    <div
                      key={method.mode_of_payment}
                      className="flex items-center gap-3 bg-gray-50 p-3 rounded"
                    >

                      {getPaymentIcon(method.type)}

                      <div className="flex-1">
                        <p className="font-medium">
                          {method.mode_of_payment}
                        </p>

                        <p className="text-xs text-gray-500">
                          {method.type}
                        </p>
                      </div>


                      <input
                        type="number"
                        value={method.opening_amount}
                        onChange={(e) =>
                          updatePaymentAmount(
                            index,
                            Number(e.target.value)
                          )
                        }
                        className="w-24 border rounded px-2 py-1"
                      />

                    </div>
                  ))}

                </div>
              </div>


              {error && (
                <div className="flex gap-2 text-red-600 bg-red-50 p-3 rounded">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}


              <button
                onClick={handleCreateOpeningEntry}
                className="w-full bg-beveren-700 text-white py-2 rounded"
              >
                Start POS Session
              </button>

            </div>
          )}


          {step === "creating" && (
            <div className="text-center py-10">
              Creating POS Session...
            </div>
          )}


          {step === "success" && (
            <div className="text-center py-10">

              <CheckCircle2 className="mx-auto text-green-600 w-10 h-10"/>

              <h3 className="font-semibold mt-3">
                POS Session Started
              </h3>

            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default POSOpeningModal;