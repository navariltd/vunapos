import { useCallback, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { PosCatalogueItem } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type UsePosBarcodeScanArgs = {
  customer?: string;
  posProfile?: string;
  priceList?: string;
};

export type BarcodeScanResult =
  | { item: PosCatalogueItem; ok: true }
  | { message: string; ok: false };

/** Resolves one physical barcode using the current server-side POS context. */
export function usePosBarcodeScan({ customer, posProfile, priceList }: UsePosBarcodeScanArgs) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [isResolving, setIsResolving] = useState(false);

  const resolve = useCallback(async (barcode: string): Promise<BarcodeScanResult> => {
    const value = barcode.trim();
    if (!value) return { message: 'A barcode is required.', ok: false };
    if (!companyUrl || !sessionId || !posProfile) {
      return { message: 'Your POS workspace is still loading. Try again in a moment.', ok: false };
    }

    setIsResolving(true);
    try {
      const item = await getVunaMethod<PosCatalogueItem>(companyUrl, sessionId, 'vunapos.api.item.resolve_barcode', {
        barcode: value,
        customer,
        pos_profile: posProfile,
        price_list: priceList,
      });
      return { item, ok: true };
    } catch (error) {
      if (error instanceof FrappeClientError && error.code === 'session') {
        void invalidateSession();
      }
      return {
        message: error instanceof Error ? error.message : 'Barcode could not be resolved.',
        ok: false,
      };
    } finally {
      setIsResolving(false);
    }
  }, [companyUrl, customer, invalidateSession, posProfile, priceList, sessionId]);

  return { isResolving, resolve };
}
