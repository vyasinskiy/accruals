import { Test, TestingModule } from '@nestjs/testing';
import { AccountantClientService } from './accountant-client.service';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../config';

describe('AccountantClientService', () => {
  let service: AccountantClientService;
  let accountantClient: ClientProxy;

  const mockAccountantClient = {
    emit: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountantClientService,
        { provide: 'ACCOUNTANT_SERVICE', useValue: mockAccountantClient },
      ],
    }).compile();

    service = module.get<AccountantClientService>(AccountantClientService);
    accountantClient = module.get<ClientProxy>('ACCOUNTANT_SERVICE');

    // Mock global fetch
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findApartments', () => {
    it('should call fetch with correct URL and filters', async () => {
      const mockResponse = [{ id: '1', address: 'Test' }];
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await service.findApartments({ address: 'Main St' });

      expect(result).toEqual(mockResponse);
      const expectedUrl = new URL('/accountant/apartments', config.ACCOUNTANT_API_URL);
      expectedUrl.searchParams.set('address', 'Main St');
      expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString());
    });

    it('should throw error if fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.findApartments({})).rejects.toThrow('Failed to fetch apartments');
    });
  });

  describe('findInvoices', () => {
    it('should handle array parameters for accountExternalId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      });

      await service.findInvoices({ accountExternalId: ['acc-1', 'acc-2'] });

      const lastCallUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      const url = new URL(lastCallUrl);
      expect(url.searchParams.getAll('accountExternalId')).toEqual(['acc-1', 'acc-2']);
    });
  });

  describe('getUploadUrl', () => {
    it('should request upload URL with correct params', async () => {
      const mockResult = { url: 'http://s3', key: 'key.pdf' };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResult),
      });

      const result = await service.getUploadUrl('acc-1', 'May 2026');

      expect(result).toEqual(mockResult);
      const lastCallUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      const url = new URL(lastCallUrl);
      expect(url.pathname).toBe('/accountant/invoices/upload-url');
      expect(url.searchParams.get('accountExternalId')).toBe('acc-1');
      expect(url.searchParams.get('periodLabel')).toBe('May 2026');
    });
  });
});
