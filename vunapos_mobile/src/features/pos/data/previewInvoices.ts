import { PosPreviewInvoice } from '@/features/pos/types';

/**
 * Sales-history display data for the invoices increment. It intentionally
 * mirrors the values shown by the SPA history view without introducing the
 * live history endpoint or invoice-detail workflow prematurely.
 */
export const previewInvoices: PosPreviewInvoice[] = [
  { customerName: 'Walk-in Customer', invoiceNumber: 'ACC-PSINV-2026-00012', itemCount: 3, paymentMode: 'Cash', postedAt: 'Today · 4:20 PM', status: 'Paid', total: 1250 },
  { customerName: 'Chemistry Stores Ltd', invoiceNumber: 'ACC-PSINV-2026-00011', itemCount: 5, paymentMode: 'M-Pesa', postedAt: 'Today · 3:46 PM', status: 'Paid', total: 8720 },
  { customerName: 'Sarah Wanjiku', invoiceNumber: 'ACC-PSINV-2026-00010', itemCount: 1, paymentMode: 'Cash', postedAt: 'Today · 2:08 PM', status: 'Paid', total: 50 },
  { customerName: 'Sunrise Farm Supplies', invoiceNumber: 'ACC-PSINV-2026-00009', itemCount: 2, paymentMode: 'Bank Transfer', postedAt: 'Yesterday · 5:32 PM', status: 'Partly Paid', total: 16400 },
  { customerName: 'Walk-in Customer', invoiceNumber: 'ACC-PSINV-2026-00008', itemCount: 4, paymentMode: 'Cash', postedAt: 'Yesterday · 4:18 PM', status: 'Paid', total: 3680 },
];
