import { extractApartments, extractAccounts, extractAccruals } from './adapter';

describe('KvartplataAdapter Extraction Logic', () => {
  describe('extractApartments', () => {
    it('should extract apartments from complex payload', () => {
      const payload = {
        data: [
          { id: 'apt-1', address: 'Main St 1', organization: 'Org A' },
          { Id: 'apt-2', Address: 'Main St 2', Organization: 'Org B' }
        ]
      };
      const result = extractApartments(payload);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        externalId: 'apt-1',
        address: 'Main St 1',
        organization: 'Org A'
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        externalId: 'apt-2',
        address: 'Main St 2',
        organization: 'Org B'
      }));
    });

    it('should deduplicate apartments by externalId', () => {
      const payload = [
        { id: 'apt-1', address: 'Addr 1' },
        { apartmentId: 'apt-1', houseAddress: 'Addr 1 Dup' }
      ];
      const result = extractApartments(payload);
      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe('apt-1');
    });
  });

  describe('extractAccounts', () => {
    const mockApartment = { externalId: 'apt-1', address: 'Addr 1', organization: 'Org 1', rawJson: '{}' };

    it('should extract accounts from nested payload with balance', () => {
      const payload = {
        accounts: [
          { id: 'acc-1', number: '123', name: 'Water', balance: -100.50 },
          { ls: 'acc-2', debt: '500,25' }
        ]
      };
      const result = extractAccounts(mockApartment, payload);
      expect(result).toHaveLength(2);
      expect(result[0].balance).toBe(-100.50);
      expect(result[1].balance).toBe(500.25);
    });
  });

  describe('extractAccruals', () => {
    const mockAccount = { externalId: 'acc-1', apartmentExternalId: 'apt-1', accountNumber: '123', accountLabel: 'Label', rawJson: '{}' };

    it('should extract accruals with various amount fields', () => {
      const payload = {
        accruals: [
          {
            periodId: '202605',
            name: 'May 2026',
            accruedAmount: '100.50',
            amountToPay: '110.00',
            button: { invoice: 'true' }
          }
        ]
      };
      const result = extractAccruals(mockAccount, payload);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        accountExternalId: 'acc-1',
        periodId: '202605',
        periodLabel: 'May 2026'
      }));
      expect(result[0].amountText).toContain('accruedAmount=100.50');
      expect(result[0].amountText).toContain('amountToPay=110.00');
      expect(result[0].statusText).toContain('button.invoice=true');
    });

    it('should fallback periodId to periodLabel if missing', () => {
      const payload = {
        Accruals: [
          { month: 'June 2026', sum: '50.00' }
        ]
      };
      const result = extractAccruals(mockAccount, payload);
      expect(result[0].periodId).toBe('June 2026');
      expect(result[0].periodLabel).toBe('June 2026');
    });
  });
});
