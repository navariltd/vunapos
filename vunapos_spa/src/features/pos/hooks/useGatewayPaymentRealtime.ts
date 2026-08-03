import { useFrappeEventListener } from "frappe-react-sdk";

import type { GatewayPaymentLinkDTO } from "../types";

export const GATEWAY_PAYMENT_EVENT = "vunapos_gateway_payment_changed";

export function useGatewayPaymentRealtime(
	onChange: (event: GatewayPaymentLinkDTO) => void,
) {
	useFrappeEventListener<GatewayPaymentLinkDTO>(GATEWAY_PAYMENT_EVENT, onChange);
}
