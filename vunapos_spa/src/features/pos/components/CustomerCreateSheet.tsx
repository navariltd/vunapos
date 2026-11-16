import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "../../../components/ui/Button";
import { Sheet } from "../../../components/ui/Sheet";
import { cn } from "../../../lib/cn";
import {
  canSaveCustomer,
  customerSuggestions,
  saveCustomerLabel,
  submitCustomerCreate,
  type CustomerCreateForm,
} from "../customerCreate";
import { useCustomerCreate } from "../hooks/useCustomerCreate";
import type { CustomerCreateOptionsDTO, CustomerDTO, CustomerMatchesDTO } from "../types";
import { PhoneInput } from "./PhoneInput";

const inputClass =
  "h-touch w-full min-w-0 rounded-md border border-outline-variant bg-surface px-3 text-sm outline-none focus:border-primary";

type CustomerCreateFieldsProps = {
  formId: string;
  form: CustomerCreateForm;
  options: CustomerCreateOptionsDTO | null;
  matches: CustomerMatchesDTO | null;
  isChecking?: boolean;
  error?: string | null;
  onChange: (patch: Partial<CustomerCreateForm>) => void;
  onUseCustomer: (customer: CustomerDTO) => void;
  onSubmit: () => void;
};

export function CustomerCreateFields({
  formId,
  form,
  options,
  matches,
  isChecking,
  error,
  onChange,
  onUseCustomer,
  onSubmit,
}: CustomerCreateFieldsProps) {
  const fieldId = useId();
  const suggestions = customerSuggestions(form, matches);
  const mobileError = form.mobile_no.trim() ? matches?.mobile_error : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form id={formId} className="space-y-4" onSubmit={submit} noValidate>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-on-surface-variant">Customer name *</span>
        <input
          autoFocus
          required
          className={inputClass}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={140}
          value={form.customer_name}
          onChange={(event) => onChange({ customer_name: event.target.value })}
        />
      </label>

      <fieldset>
        <legend className="mb-1 block text-xs font-medium text-on-surface-variant">Customer type</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {(options?.customer_types || []).map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={form.customer_type === type}
              className={cn(
                "min-h-10 rounded-full border px-4 text-sm",
                form.customer_type === type
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant text-on-surface hover:bg-surface-container",
              )}
              onClick={() => onChange({ customer_type: type })}
            >
              {type}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${fieldId}-mobile`} className="mb-1 block text-xs font-medium text-on-surface-variant">
          Mobile number
        </label>
        <PhoneInput
          id={`${fieldId}-mobile`}
          country={form.mobile_country}
          countries={options?.countries || []}
          value={form.mobile_no}
          invalid={Boolean(mobileError)}
          describedBy={`${fieldId}-mobile-hint`}
          onCountryChange={(mobile_country) => onChange({ mobile_country })}
          onChange={(mobile_no) => onChange({ mobile_no })}
        />
        <p id={`${fieldId}-mobile-hint`} className={cn("mt-1 text-xs", mobileError ? "text-error" : "text-on-surface-variant")}>
          {mobileError
            ? mobileError
            : form.mobile_no.trim() && matches?.mobile_no
              ? `Saved as ${matches.mobile_no}`
              : "Optional. Local formats such as 0712 345 678 are fine."}
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-on-surface-variant">Email</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="done"
          className={inputClass}
          placeholder="Optional"
          value={form.email_id}
          onChange={(event) => onChange({ email_id: event.target.value })}
        />
      </label>

      {suggestions.kind !== "none" ? (
        <section
          aria-live="polite"
          className={cn(
            "rounded-md border p-3",
            suggestions.kind === "mobile" ? "border-tertiary/40 bg-tertiary-container/30" : "border-outline-variant bg-surface-container-low",
          )}
        >
          <p className="text-sm font-medium text-on-surface">
            {suggestions.kind === "mobile" ? "This number already belongs to a customer" : "Similar customers"}
          </p>
          <p className="mb-2 text-xs text-on-surface-variant">
            {suggestions.kind === "mobile"
              ? "Use the existing customer, or create a new one anyway."
              : "Use one of these, or save a new customer."}
          </p>
          <ul className="divide-y divide-outline-variant">
            {suggestions.customers.map((customer) => (
              <li key={customer.customer} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-on-surface">{customer.customer_name}</span>
                  <span className="block truncate text-xs text-on-surface-variant">
                    {customer.mobile_no || customer.email_id || customer.customer}
                  </span>
                </span>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => onUseCustomer(customer)}>
                  Use this customer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : isChecking ? (
        <p className="text-xs text-on-surface-variant">Checking existing customers…</p>
      ) : null}

      {options?.customer_group || options?.territory ? (
        <p className="text-xs text-on-surface-variant">
          {[options.customer_group && `Group: ${options.customer_group}`, options.territory && `Territory: ${options.territory}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md bg-error-container p-2 text-sm text-on-error-container">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type CustomerCreateSheetProps = {
  posProfile?: string;
  initialName?: string;
  onClose: () => void;
  onSelect: (customer: CustomerDTO) => void | Promise<void>;
};

// The POS create form in both modes: a bottom sheet on phones, a dialog on larger screens.
export function CustomerCreateSheet({ posProfile, initialName = "", onClose, onSelect }: CustomerCreateSheetProps) {
  const formId = useId();
  const inFlight = useRef(false);
  const [draft, setDraft] = useState<Partial<CustomerCreateForm>>({ customer_name: initialName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useCustomerCreate(posProfile, draft);
  const { form, options, matches } = loaded;

  const change = (patch: Partial<CustomerCreateForm>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const use = (customer: CustomerDTO) => {
    void onSelect(customer);
    onClose();
  };
  const save = async () => {
    if (inFlight.current || !canSaveCustomer(form, busy)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await submitCustomerCreate(form, posProfile, loaded.create, onSelect);
    inFlight.current = false;
    setBusy(false);
    if (result.status === "created") onClose();
    else setError(result.message);
  };

  return (
    <Sheet
      isOpen
      title="New customer"
      description="The customer is selected once saved."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!canSaveCustomer(form, busy) || !options}>
            {saveCustomerLabel(form, matches, busy)}
          </Button>
        </div>
      }
    >
      <CustomerCreateFields
        formId={formId}
        form={form}
        options={options}
        matches={matches}
        isChecking={loaded.isChecking}
        error={error || loaded.optionsError}
        onChange={change}
        onUseCustomer={use}
        onSubmit={() => void save()}
      />
    </Sheet>
  );
}
