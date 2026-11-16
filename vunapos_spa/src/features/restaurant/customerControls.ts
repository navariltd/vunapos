// A visit's customer is fixed once its first round is placed (the server rejects
// later changes with SESSION_CUSTOMER_LOCKED), so choosing and creating stop there.
export function restaurantCustomerControls({
	allowCreation,
	roundCount,
	readOnly,
}: {
	allowCreation: boolean;
	roundCount: number;
	readOnly: boolean;
}) {
	const disabled = roundCount > 0 || readOnly;
	return { disabled, allowCreate: allowCreation && !disabled };
}
