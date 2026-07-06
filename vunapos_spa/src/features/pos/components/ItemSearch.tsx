type ItemSearchProps = {
	value: string;
	onChange: (value: string) => void;
	isLoading?: boolean;
};

export function ItemSearch({ isLoading, onChange, value }: ItemSearchProps) {
	return (
		<div className="sticky top-0 z-20 border-b border-outline-variant bg-surface pb-4">
			<div className="flex items-center gap-3">
				<input
					id="item-search"
					className="h-touch flex-1 rounded-md border border-outline-variant bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary"
					placeholder="Search by item name, code, or barcode"
					value={value}
					onChange={(event) => onChange(event.target.value)}
				/>
				{isLoading ? <span className="text-sm text-on-surface-variant">Searching...</span> : null}
			</div>
		</div>
	);
}
