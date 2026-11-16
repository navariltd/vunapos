import { ChevronDown } from "lucide-react";

import { cleanPhoneInput } from "../customerCreate";

type Country = { country: string; code: string; isd: string };

type PhoneInputProps = {
  id: string;
  country: string;
  countries: Country[];
  value: string;
  invalid?: boolean;
  describedBy?: string;
  onCountryChange: (country: string) => void;
  onChange: (value: string) => void;
};

// The country code shows as its dialling prefix; the native select underneath
// opens the platform picker on phones and stays keyboard accessible.
export function PhoneInput({
  id,
  country,
  countries,
  value,
  invalid,
  describedBy,
  onCountryChange,
  onChange,
}: PhoneInputProps) {
  const isd = countries.find((row) => row.country === country)?.isd || "+";
  return (
    <div className="flex min-w-0 gap-2">
      <div className="relative flex h-touch w-24 shrink-0 items-center justify-between rounded-md border border-outline-variant bg-surface px-3 text-sm focus-within:border-primary">
        <span aria-hidden="true" className="font-medium tabular-nums text-on-surface">
          {isd}
        </span>
        <ChevronDown className="size-4 text-on-surface-variant" aria-hidden="true" />
        <select
          aria-label="Country code"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={country}
          onChange={(event) => onCountryChange(event.target.value)}
        >
          {countries.map((row) => (
            <option key={row.country} value={row.country}>
              {row.country} ({row.isd})
            </option>
          ))}
        </select>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        enterKeyHint="next"
        placeholder="Mobile number"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`h-touch min-w-0 flex-1 rounded-md border bg-surface px-3 text-sm outline-none focus:border-primary ${
          invalid ? "border-error" : "border-outline-variant"
        }`}
        value={value}
        onChange={(event) => onChange(cleanPhoneInput(event.target.value))}
      />
    </div>
  );
}
