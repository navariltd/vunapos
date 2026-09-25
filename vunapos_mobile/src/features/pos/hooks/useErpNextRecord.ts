import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';

type ErpNextRecord = {
  doctype: string;
  name: string;
};

export function erpNextRecordUrl(companyUrl: string, { doctype, name }: ErpNextRecord) {
  const route = `/app/${doctype.trim().toLowerCase().replace(/\s+/g, '-')}/${encodeURIComponent(name)}`;
  return new URL(route, companyUrl).toString();
}

/** Opens the matching ERPNext Desk record without passing the app session through the URL. */
export function useErpNextRecord() {
  const { companyUrl } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  async function openRecord(record: ErpNextRecord) {
    if (isOpening) return;
    if (!companyUrl) {
      setError('Set a company URL before opening ERPNext.');
      return;
    }

    setError(null);
    setIsOpening(true);
    try {
      await WebBrowser.openBrowserAsync(erpNextRecordUrl(companyUrl, record));
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open ERPNext on this device.');
    } finally {
      setIsOpening(false);
    }
  }

  return { error, isOpening, openRecord };
}
