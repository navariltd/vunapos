import {
  allocatePaymentRemainderToNextMode,
  buildPaymentInputs,
  calculatePaymentAllocation,
  canCompletePaymentAllocation,
  createInitialPaymentAmounts,
  parsePaymentAmount,
} from '@/features/pos/paymentAllocation';
import { PosPaymentMode } from '@/features/pos/types';

const modes: PosPaymentMode[] = [
  { default: true, mode_of_payment: 'Cash', type: 'Cash' },
  { mode_of_payment: 'M-Pesa', type: 'Phone' },
  { mode_of_payment: 'Card', type: 'Bank' },
];

describe('payment allocation', () => {
  it('starts with the default manual payment mode covering the full amount', () => {
    expect(createInitialPaymentAmounts(modes, 150000, 2)).toEqual({ Cash: '1500.00', 'M-Pesa': '', Card: '' });
  });

  it('calculates split payments in precise minor units', () => {
    expect(calculatePaymentAllocation(modes, { Cash: '500', 'M-Pesa': '1000.00', Card: '' }, 150000, 2)).toEqual({
      allocatedMinor: 150000,
      cashMinor: 50000,
      hasInvalidAmount: false,
      nonCashMinor: 100000,
      remainingMinor: 0,
    });
  });

  it('allows cash change but rejects electronic overpayment', () => {
    const cashChange = calculatePaymentAllocation(modes, { Cash: '700', 'M-Pesa': '0', Card: '0' }, 65400, 2);
    expect(canCompletePaymentAllocation(cashChange, 65400, false)).toBe(true);

    const electronicOverpayment = calculatePaymentAllocation(modes, { Cash: '0', 'M-Pesa': '700', Card: '0' }, 65400, 2);
    expect(canCompletePaymentAllocation(electronicOverpayment, 65400, false)).toBe(false);
  });

  it('only permits underpayment where the profile enables partial payments', () => {
    const allocation = calculatePaymentAllocation(modes, { Cash: '500', 'M-Pesa': '', Card: '' }, 65400, 2);
    expect(canCompletePaymentAllocation(allocation, 65400, false)).toBe(false);
    expect(canCompletePaymentAllocation(allocation, 65400, true)).toBe(true);
  });

  it('moves the remainder to the next configured manual payment mode', () => {
    expect(allocatePaymentRemainderToNextMode(modes, { Cash: '500', 'M-Pesa': '', Card: '' }, 'Cash', 150000, 2))
      .toEqual({ Cash: '500', 'M-Pesa': '1000.00', Card: '' });
  });

  it('rejects invalid monetary input and only serializes positive allocations', () => {
    expect(parsePaymentAmount('10.001', 2)).toBeNull();
    expect(parsePaymentAmount('1e3', 2)).toBeNull();
    expect(buildPaymentInputs(modes, { Cash: '500.00', 'M-Pesa': '1000', Card: '0' }, 2)).toEqual([
      { amount: 500, mode_of_payment: 'Cash' },
      { amount: 1000, mode_of_payment: 'M-Pesa' },
    ]);
  });
});
