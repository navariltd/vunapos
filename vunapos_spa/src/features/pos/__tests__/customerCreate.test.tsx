import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: vi.fn() }) }));

import { VunaApiError } from "../../../services/vunaApi";
import { CustomerCreateFields } from "../components/CustomerCreateSheet";
import { PhoneInput } from "../components/PhoneInput";
import {
  buildCreateCustomerParams,
  canSaveCustomer,
  cleanPhoneInput,
  customerSuggestions,
  emptyCustomerForm,
  saveCustomerLabel,
  submitCustomerCreate,
  type CustomerCreateForm,
} from "../customerCreate";
import type { CustomerCreateOptionsDTO, CustomerMatchesDTO } from "../types";

const options: CustomerCreateOptionsDTO = {
  customer_types: ["Company", "Individual", "Partnership"],
  default_customer_type: "Individual",
  countries: [
    { country: "Kenya", code: "KE", isd: "+254" },
    { country: "Uganda", code: "UG", isd: "+256" },
  ],
  default_country: "Kenya",
  customer_group: "Individual",
  territory: "Nairobi",
};
const wanjiru = { customer: "CUST-1", customer_name: "Wanjiru Kamau", mobile_no: "+254-712345678" };
const noMatches: CustomerMatchesDTO = { mobile_no: null, mobile_error: null, mobile_matches: [], similar: [] };

function form(patch: Partial<CustomerCreateForm> = {}): CustomerCreateForm {
  return { ...emptyCustomerForm(options), customer_name: "Wanjiru", ...patch };
}

function render(formValue: CustomerCreateForm, matches: CustomerMatchesDTO | null = null) {
  return renderToStaticMarkup(
    <CustomerCreateFields
      formId="new-customer"
      form={formValue}
      options={options}
      matches={matches}
      onChange={() => {}}
      onUseCustomer={() => {}}
      onSubmit={() => {}}
    />,
  );
}

describe("customer create form", () => {
  it("defaults to Individual and the company's country", () => {
    expect(emptyCustomerForm(options, "Ann")).toEqual({
      customer_name: "Ann",
      customer_type: "Individual",
      mobile_country: "Kenya",
      mobile_no: "",
      email_id: "",
    });
  });

  it("offers the customer types read from the Customer doctype, Individual selected", () => {
    const html = render(form());
    for (const type of options.customer_types) expect(html).toContain(`>${type}</button>`);
    expect(html).toMatch(/aria-checked="true"[^>]*>Individual</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Company</);
  });

  it("shows a tel input with the selected country's dialling code", () => {
    const html = renderToStaticMarkup(
      <PhoneInput id="m" country="Uganda" countries={options.countries} value="" onChange={() => {}} onCountryChange={() => {}} />,
    );
    expect(html).toContain('type="tel"');
    expect(html).toContain('inputMode="tel"');
    expect(html).toContain(">+256</span>");
    expect(html).toContain('aria-label="Country code"');
    expect(html).toContain("Kenya (+254)");
  });

  it("keeps only phone characters while typing", () => {
    expect(cleanPhoneInput("0712 abc 345-678")).toBe("0712  345-678");
    expect(cleanPhoneInput("+254 (712) 345678")).toBe("+254 (712) 345678");
  });

  it("sends trimmed values and the country only with a mobile number", () => {
    expect(buildCreateCustomerParams(form({ customer_name: "  Ann  ", email_id: " " }), "Nairobi")).toEqual({
      customer_name: "Ann",
      customer_type: "Individual",
      pos_profile: "Nairobi",
    });
    expect(
      buildCreateCustomerParams(form({ mobile_no: " 0712 345 678 ", email_id: "a@b.co", customer_type: "Company" })),
    ).toEqual({
      customer_name: "Wanjiru",
      customer_type: "Company",
      mobile_no: "0712 345 678",
      mobile_country: "Kenya",
      email_id: "a@b.co",
      pos_profile: undefined,
    });
  });

  it("warns when the mobile number belongs to a customer, offering Create anyway", () => {
    const matches = { ...noMatches, mobile_no: "+254-712345678", mobile_matches: [wanjiru] };
    const value = form({ mobile_no: "0712345678" });
    expect(customerSuggestions(value, matches)).toEqual({ kind: "mobile", customers: [wanjiru] });
    expect(canSaveCustomer(value)).toBe(true);
    expect(saveCustomerLabel(value, matches)).toBe("Create anyway");
    const html = render(value, matches);
    expect(html).toContain("This number already belongs to a customer");
    expect(html).toContain("Use this customer");
    expect(html).toContain("create a new one anyway");
  });

  it("only mentions a matching number on customers outside the till's Customer Groups", () => {
    const matches = { ...noMatches, mobile_no: "+254-712345678", mobile_elsewhere: true };
    const value = form({ mobile_no: "0712345678" });
    expect(customerSuggestions(value, matches)).toEqual({ kind: "elsewhere", customers: [] });
    expect(canSaveCustomer(value)).toBe(true);
    expect(saveCustomerLabel(value, matches)).toBe("Create anyway");
    const html = render(value, matches);
    expect(html).toContain("not available at this till");
    expect(html).not.toContain("Use this customer");
  });

  it("only suggests similar names when no mobile is entered, still allowing save", () => {
    const matches = { ...noMatches, similar: [wanjiru] };
    expect(customerSuggestions(form(), matches).kind).toBe("similar");
    expect(canSaveCustomer(form())).toBe(true);
    expect(saveCustomerLabel(form(), matches)).toBe("Save customer");
    expect(render(form(), matches)).toContain("Similar customers");
    expect(customerSuggestions(form({ mobile_no: "0799000000" }), matches).kind).toBe("none");
  });

  it("requires a name and blocks while saving", () => {
    expect(canSaveCustomer(form({ customer_name: "  " }))).toBe(false);
    expect(canSaveCustomer(form(), true)).toBe(false);
    expect(saveCustomerLabel(form(), null, true)).toBe("Saving…");
  });

  it("shows the normalised number or the server's mobile error", () => {
    expect(render(form({ mobile_no: "0712345678" }), { ...noMatches, mobile_no: "+254-712345678" })).toContain(
      "Saved as +254-712345678",
    );
    expect(
      render(form({ mobile_no: "0700" }), { ...noMatches, mobile_error: "Enter a valid mobile number for the selected country." }),
    ).toContain("Enter a valid mobile number");
  });

  it("selects the new customer on the order once created", async () => {
    const created = { customer: "CUST-2", customer_name: "Wanjiru" };
    const create = vi.fn().mockResolvedValue(created);
    const onCreated = vi.fn();
    await expect(submitCustomerCreate(form(), "Nairobi", create, onCreated)).resolves.toEqual({
      status: "created",
      customer: created,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customer_name: "Wanjiru", pos_profile: "Nairobi" }));
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("still reports a created customer when selecting it fails", async () => {
    const created = { customer: "CUST-3", customer_name: "Wanjiru" };
    const result = await submitCustomerCreate(form(), undefined, vi.fn().mockResolvedValue(created), () => {
      throw new Error("Order is locked");
    });
    expect(result.status).toBe("created");
  });

  it("reports other errors with their field", async () => {
    const create = vi.fn().mockRejectedValue(new VunaApiError("Enter a valid mobile", "INVALID_MOBILE_NUMBER", "mobile_no"));
    await expect(submitCustomerCreate(form(), undefined, create, vi.fn())).resolves.toEqual({
      status: "error",
      message: "Enter a valid mobile",
      field: "mobile_no",
    });
  });
});
