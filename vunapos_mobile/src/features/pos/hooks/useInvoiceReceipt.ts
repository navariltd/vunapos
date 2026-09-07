import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type InvoiceReceipt = {
  html: string;
  invoice_doctype: string;
  invoice_name: string;
  print_format?: string | null;
};

type ReceiptRequest = {
  invoiceDoctype: string;
  invoiceName: string;
};

type UseInvoiceReceiptResult = {
  error: string | null;
  isWorking: boolean;
  printReceipt: (request: ReceiptRequest) => Promise<void>;
  shareReceipt: (request: ReceiptRequest) => Promise<void>;
};

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Could not prepare this receipt.';
}

/** Requests the server's receipt HTML, then hands it to the platform print or share UI. */
export function useInvoiceReceipt(): UseInvoiceReceiptResult {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function renderReceipt({ invoiceDoctype, invoiceName }: ReceiptRequest) {
    if (!companyUrl || !sessionId) {
      throw new Error('Your session has expired. Sign in again to continue.');
    }

    const receipt = await getVunaMethod<InvoiceReceipt>(companyUrl, sessionId, 'vunapos.api.print.render_invoice', {
      invoice_doctype: invoiceDoctype,
      invoice_name: invoiceName,
    });
    if (!receipt.html?.trim()) {
      throw new Error('The server did not return a receipt for this invoice.');
    }
    return receipt.html;
  }

  async function perform(request: ReceiptRequest, action: 'print' | 'share') {
    if (isWorking) return;
    setError(null);
    setIsWorking(true);

    try {
      const html = await renderReceipt(request);
      if (action === 'print') {
        await Print.printAsync({ html });
        return;
      }

      if (!await Sharing.isAvailableAsync()) {
        throw new Error('Sharing is not available on this device.');
      }
      const file = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(file.uri, { UTI: 'com.adobe.pdf', mimeType: 'application/pdf' });
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        await invalidateSession();
        return;
      }
      setError(messageFor(requestError));
    } finally {
      setIsWorking(false);
    }
  }

  return {
    error,
    isWorking,
    printReceipt: (request) => perform(request, 'print'),
    shareReceipt: (request) => perform(request, 'share'),
  };
}
