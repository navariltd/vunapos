import type { PosCustomerShippingAddress } from "@/features/pos/types";

/** Search only the customer addresses already permitted by the backend. */
export function filterShippingAddresses(
  addresses: readonly PosCustomerShippingAddress[],
  query: string,
): PosCustomerShippingAddress[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...addresses];

  return addresses.filter((address) => {
    const searchable = [
      address.name,
      address.address_title,
      address.formatted_address,
      address.address_line1,
      address.address_line2,
      address.city,
      address.state,
      address.pincode,
      address.country,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
