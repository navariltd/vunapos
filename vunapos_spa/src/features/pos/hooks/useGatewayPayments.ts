import { useMemo } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
	attachC2bGatewayPayment,
	cancelGatewayPaymentLink,
	getGatewayPaymentStatus,
	initiateStkGatewayPayment,
	vunaMethods,
} from "../../../services/vunaApi";

export function useGatewayPayments() {
	const initiateStkCall = useFrappePostCall(vunaMethods.initiateStkGatewayPayment);
	const statusCall = useFrappePostCall(vunaMethods.getGatewayPaymentStatus);
	const cancelCall = useFrappePostCall(vunaMethods.cancelGatewayPaymentLink);
	const attachC2bCall = useFrappePostCall(vunaMethods.attachC2bGatewayPayment);

	return useMemo(
		() => ({
			initiateStkPayment: (params: Parameters<typeof initiateStkGatewayPayment>[1]) =>
				initiateStkGatewayPayment(initiateStkCall.call, params),
			getGatewayPaymentStatus: (gatewayPaymentLink: string) =>
				getGatewayPaymentStatus(statusCall.call, gatewayPaymentLink),
			cancelGatewayPaymentLink: (gatewayPaymentLink: string) =>
				cancelGatewayPaymentLink(cancelCall.call, gatewayPaymentLink),
			attachC2bPayment: (params: Parameters<typeof attachC2bGatewayPayment>[1]) =>
				attachC2bGatewayPayment(attachC2bCall.call, params),
		}),
		[attachC2bCall.call, cancelCall.call, initiateStkCall.call, statusCall.call],
	);
}
