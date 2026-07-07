import { useState } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { CustomerDTO } from "../types";
import { useCustomerSearch } from "../hooks/useCustomerSearch";

type CustomerSelectorProps = {
	onClear?: () => void;
	onSelect: (customer: CustomerDTO) => void;
	selectedCustomer?: CustomerDTO | null;
};

export function CustomerSelector({ onClear, onSelect, selectedCustomer }: CustomerSelectorProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [showCreate, setShowCreate] = useState(false);
	const [customerName, setCustomerName] = useState("");
	const { create, customers, error, isCreating, isLoading } = useCustomerSearch(query);

	const toggleDropdown = () => {
		setIsOpen((current) => {
			const nextOpen = !current;
			if (nextOpen) {
				setQuery("");
			}
			return nextOpen;
		});
	};

	const handleCreate = async () => {
		if (!customerName.trim()) {
			return;
		}
		const customer = await create({ customer_name: customerName.trim() });
		onSelect(customer);
		setCustomerName("");
		setShowCreate(false);
		setQuery("");
		setIsOpen(false);
	};

	return (
		<div className="relative">
			<label className="mb-2 block text-sm font-semibold text-on-surface">Customer</label>
			<div className="flex min-h-touch items-center rounded-md border border-outline-variant bg-surface-container-low">
				<button
					type="button"
					className="min-w-0 flex-1 px-3 py-2 text-left"
					onClick={toggleDropdown}
				>
					<span className="block truncate text-sm font-medium text-on-surface">
						{selectedCustomer?.customer_name || "Select customer"}
					</span>
					<span className="block truncate text-xs text-on-surface-variant">
						{selectedCustomer?.mobile_no || selectedCustomer?.email_id || selectedCustomer?.customer || "Search or choose from the list"}
					</span>
				</button>
				{selectedCustomer ? (
					<button
						type="button"
						className="flex h-touch w-touch items-center justify-center text-on-surface-variant hover:text-error"
						onClick={() => {
							onClear?.();
							setQuery("");
							setIsOpen(true);
						}}
						aria-label="Clear selected customer"
					>
						<X className="size-4" />
					</button>
				) : null}
				<button
					type="button"
					className="flex h-touch w-touch items-center justify-center text-on-surface-variant hover:text-on-surface"
					onClick={toggleDropdown}
					aria-label="Open customer list"
				>
					<ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
				</button>
			</div>

			{isOpen ? (
				<div className="absolute left-0 right-0 z-30 mt-2 rounded-md border border-outline-variant bg-surface p-3 shadow-lg">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
						<input
							className="h-touch w-full rounded-md border border-outline-variant bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary"
							placeholder="Search customers"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>

					{isLoading ? <p className="mt-2 text-xs text-on-surface-variant">Searching customers...</p> : null}
					{error ? <p className="mt-2 text-xs text-error">{error}</p> : null}

					<div className="mt-3 max-h-48 overflow-auto rounded-md border border-outline-variant">
						{customers.length ? (
							customers.map((customer) => (
								<button
									key={customer.customer}
									type="button"
									className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-container-low"
									onClick={() => {
										onSelect(customer);
										setQuery("");
										setIsOpen(false);
									}}
								>
									<span className="font-medium text-on-surface">{customer.customer_name}</span>
									<span className="block text-xs text-on-surface-variant">
										{customer.mobile_no || customer.email_id || customer.customer}
									</span>
								</button>
							))
						) : (
							<p className="px-3 py-2 text-sm text-on-surface-variant">No customers found.</p>
						)}
					</div>

					<div className="mt-3 space-y-2">
					<Button
						variant="ghost"
						size="sm"
						className="gap-2"
						onClick={() => setShowCreate((current) => !current)}
					>
						<Plus className="size-4" />
						Create customer
					</Button>
					{showCreate ? (
						<div className="flex gap-2">
							<input
								className="h-touch min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-3 text-sm outline-none focus:border-primary"
								placeholder="Customer name"
								value={customerName}
								onChange={(event) => setCustomerName(event.target.value)}
							/>
							<Button disabled={isCreating || !customerName.trim()} onClick={handleCreate}>
								Save
							</Button>
						</div>
					) : null}
				</div>
				</div>
			) : null}
		</div>
	);
}
