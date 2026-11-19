// Prints a rendered print format through a hidden iframe, so the page itself stays put.
export function printHtml(html: string) {
	const printFrame = document.createElement("iframe");
	printFrame.style.position = "fixed";
	printFrame.style.right = "0";
	printFrame.style.bottom = "0";
	printFrame.style.width = "0";
	printFrame.style.height = "0";
	printFrame.style.border = "0";
	printFrame.setAttribute("aria-hidden", "true");
	document.body.appendChild(printFrame);

	const printDocument = printFrame.contentWindow?.document;
	if (!printDocument) {
		printFrame.remove();
		return;
	}

	printDocument.open();
	printDocument.write(html);
	printDocument.close();

	window.setTimeout(() => {
		printFrame.contentWindow?.focus();
		printFrame.contentWindow?.print();
		window.setTimeout(() => printFrame.remove(), 1000);
	}, 100);
}
