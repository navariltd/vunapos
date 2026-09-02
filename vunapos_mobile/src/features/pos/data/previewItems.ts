import { PosPreviewItem } from '@/features/pos/types';

/**
 * Representative catalogue cards from the SPA mobile view. These are local
 * display data for the shell increment; the authenticated bootstrap endpoint
 * will replace them in the catalogue-data increment.
 */
export const previewItems: PosPreviewItem[] = [
  { itemCode: 'STO-ITEM-2026-00005', itemName: 'Burette', price: 0, quantity: 0, taxLabel: 'Tax excl. · 16%' },
  { itemCode: 'STO-ITEM-2026-00004', itemName: 'Plastic beakers 250ML', price: 0, quantity: 0, taxLabel: 'Tax excl. · 16%' },
  { itemCode: 'STO-ITEM-2026-00008', itemName: 'Sodium hydroxide pellets', price: 0, quantity: 0, taxLabel: 'Tax excl. · 16%' },
  { itemCode: 'STO-ITEM-2026-00006', itemName: 'Sunrise fumigant', price: 0, quantity: 0, taxLabel: 'Tax excl. · 16%' },
  { itemCode: '0045r', itemName: '415A toner', price: 0, quantity: 0, taxLabel: 'Tax excl. · 16%' },
  { itemCode: '90 Days 200ml*21 ESL', itemName: '90 Days 200ml*21 ESL', price: 50, quantity: 10000, taxLabel: 'Tax excl. · 16%' },
];
