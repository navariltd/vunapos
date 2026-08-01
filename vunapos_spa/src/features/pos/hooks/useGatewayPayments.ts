import { useMemo } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
	attachC2bGatewayPayment,
	cancelGatewayPaymentLink,
	getGatewayPaymentStatus,
	initiateStkGatewayPayment,
	searchC2bGatewayPayments,
	vunaMethods,
} from "../../../services/vunaApi";

export function useGatewayPayments() {
	const initiateStkCall = useFrappePostCall(vunaMethods.initiateStkGatewayPayment);
	const statusCall = useFrappePostCall(vunaMethods.getGatewayPaymentStatus);
	const cancelCall = useFrappePostCall(vunaMethods.cancelGatewayPaymentLink);
	const attachC2bCall = useFrappePostCall(vunaMethods.attachC2bGatewayPayment);
	const searchC2bCall = useFrappePostCall(vunaMethods.searchC2bGatewayPayments);

	return useMemo(
		() => ({
			initiateStkPayment: (params: Parameters<typeof initiateStkGatewayPayment>[1]) =>
				initiateStkGatewayPayment(initiateStkCall.call, params),
			getGatewayPaymentStatus: (gatewayPaymentLink: string) =>
				getGatewayPaymentStatus(statusCall.call, gatewayPaymentLink),
			cancelGatewayPaymentLink: (gatewayPaymentLink: string) =>
				cancelGatewayPaymentLink(cancelCall.call, gatewayPaymentLink),
			searchC2bPayments: (params: Parameters<typeof searchC2bGatewayPayments>[1]) =>
				searchC2bGatewayPayments(searchC2bCall.call, params),
			attachC2bPayment: (params: Parameters<typeof attachC2bGatewayPayment>[1]) =>
				attachC2bGatewayPayment(attachC2bCall.call, params),
		}),
		[attachC2bCall.call, cancelCall.call, initiateStkCall.call, searchC2bCall.call, statusCall.call],
	);
}
