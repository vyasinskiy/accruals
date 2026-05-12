import { Test, TestingModule } from '@nestjs/testing';
import { ScrapingService } from './scraping.service';
import { AccountantClientService } from '../../common/services/accountant-client.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KvartplataAdapter } from './adapter';
import { ClientProxy } from '@nestjs/microservices';
import * as fs from 'node:fs';
import { of } from 'rxjs';

jest.mock('node:fs');

describe('ScrapingService', () => {
  let service: ScrapingService;
  let accountantClientService: AccountantClientService;
  let prismaService: PrismaService;
  let accountantClient: ClientProxy;

  const mockAccountantClientService = {
    findApartments: jest.fn(),
    findInvoices: jest.fn(),
    getUploadUrl: jest.fn(),
  };

  const mockPrismaService = {
    run: {
      create: jest.fn().mockResolvedValue({ id: 'run-id' }),
      update: jest.fn().mockResolvedValue({ id: 'run-id' }),
    },
  };

  const mockAccountantClient = {
    emit: jest.fn(),
    send: jest.fn().mockReturnValue(of({})),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScrapingService,
        { provide: AccountantClientService, useValue: mockAccountantClientService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: 'ACCOUNTANT_SERVICE', useValue: mockAccountantClient },
      ],
    }).compile();

    service = module.get<ScrapingService>(ScrapingService);
    accountantClientService = module.get<AccountantClientService>(AccountantClientService);
    prismaService = module.get<PrismaService>(PrismaService);
    accountantClient = module.get<ClientProxy>('ACCOUNTANT_SERVICE');

    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    // Mock global fetch
    global.fetch = jest.fn();
  });

  it('should skip invoice if it is already uploaded to S3', async () => {
    const mockInvoice = {
      accountExternalId: 'acc-1',
      periodId: '202605',
      periodLabel: 'May 2026',
      available: true,
      invoiceUrl: 'http://example.com/invoice.pdf',
      uploadedToS3: false,
    };

    jest.spyOn(KvartplataAdapter.prototype, 'scan').mockResolvedValue({
      apartments: [],
      accounts: [{ externalId: 'acc-1', apartmentExternalId: 'apt-1' } as any],
      accruals: [],
      invoices: [mockInvoice as any],
      needsLogin: false,
      degraded: false,
      message: 'Scan successful',
    });

    mockAccountantClientService.findApartments.mockResolvedValue([]);
    mockAccountantClientService.findInvoices.mockResolvedValue([{ 
        accountExternalId: 'acc-1', 
        periodId: '202605',
        uploadedToS3: true 
    }]);

    const summary = await service.scan({ trigger: 'manual' });

    expect(summary.status).toBe('success');
    expect(mockAccountantClientService.findInvoices).toHaveBeenCalledWith(expect.objectContaining({
      accountExternalId: ['acc-1'],
      uploadedToS3: true,
    }));
    expect(mockAccountantClientService.getUploadUrl).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    // It should still emit upsert_invoice to keep accountant updated, but without uploadedToS3: true change if it was already true?
    // Actually the code emits it anyway.
    expect(accountantClient.emit).toHaveBeenCalledWith('upsert_invoice', expect.objectContaining({
        accountExternalId: 'acc-1',
        periodId: '202605'
    }));
  });

  it('should download and upload invoice if it is not in S3', async () => {
    const mockInvoice = {
      accountExternalId: 'acc-1',
      periodId: '202605',
      periodLabel: 'May 2026',
      available: true,
      invoiceUrl: 'http://example.com/invoice.pdf',
      uploadedToS3: false,
      rawJson: '{}',
    };

    jest.spyOn(KvartplataAdapter.prototype, 'scan').mockResolvedValue({
      apartments: [],
      accounts: [{ externalId: 'acc-1', apartmentExternalId: 'apt-1' } as any],
      accruals: [],
      invoices: [mockInvoice as any],
      needsLogin: false,
      degraded: false,
      message: 'Scan successful',
    });

    const mockPdfBuffer = Buffer.from('pdf content');
    jest.spyOn(KvartplataAdapter.prototype, 'downloadInvoice').mockResolvedValue(mockPdfBuffer);

    mockAccountantClientService.findApartments.mockResolvedValue([]);
    mockAccountantClientService.findInvoices.mockResolvedValue([]); // No existing invoice
    mockAccountantClientService.getUploadUrl.mockResolvedValue({
      url: 'http://s3-upload-url',
      key: 'invoices/acc-1/202605.pdf',
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const summary = await service.scan({ trigger: 'manual' });

    expect(summary.status).toBe('success');
    expect(mockAccountantClientService.getUploadUrl).toHaveBeenCalledWith('acc-1', 'May 2026');
    expect(KvartplataAdapter.prototype.downloadInvoice).toHaveBeenCalledWith('http://example.com/invoice.pdf');
    expect(global.fetch).toHaveBeenCalledWith('http://s3-upload-url', expect.objectContaining({
      method: 'PUT',
      body: new Uint8Array(mockPdfBuffer),
    }));
    expect(accountantClient.emit).toHaveBeenCalledWith('upsert_invoice', expect.objectContaining({
      accountExternalId: 'acc-1',
      uploadedToS3: true,
      localFilePath: 'invoices/acc-1/202605.pdf',
    }));
  });

  it('should process invoice if it exists in DB but is NOT marked as uploaded', async () => {
    const mockInvoice = {
      accountExternalId: 'acc-2',
      periodId: '202606',
      periodLabel: 'June 2026',
      available: true,
      invoiceUrl: 'http://example.com/invoice2.pdf',
      uploadedToS3: false,
      rawJson: '{}',
    };

    jest.spyOn(KvartplataAdapter.prototype, 'scan').mockResolvedValue({
      apartments: [],
      accounts: [{ externalId: 'acc-2', apartmentExternalId: 'apt-1' } as any],
      accruals: [],
      invoices: [mockInvoice as any],
      needsLogin: false,
      degraded: false,
      message: 'Scan successful',
    });

    const mockPdfBuffer = Buffer.from('pdf content 2');
    jest.spyOn(KvartplataAdapter.prototype, 'downloadInvoice').mockResolvedValue(mockPdfBuffer);

    mockAccountantClientService.findApartments.mockResolvedValue([]);
    mockAccountantClientService.findInvoices.mockResolvedValue([]); // uploadedToS3 filter is true, so it should return empty
    mockAccountantClientService.getUploadUrl.mockResolvedValue({
      url: 'http://s3-upload-url-2',
      key: 'invoices/acc-2/202606.pdf',
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const summary = await service.scan({ trigger: 'manual' });

    expect(summary.status).toBe('success');
    expect(mockAccountantClientService.getUploadUrl).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
    expect(accountantClient.emit).toHaveBeenCalledWith('upsert_invoice', expect.objectContaining({
      accountExternalId: 'acc-2',
      uploadedToS3: true,
    }));
  });

  it('should set status to warning if an invoice upload fails', async () => {
    const mockInvoice = {
      accountExternalId: 'acc-3',
      periodId: '202607',
      periodLabel: 'July 2026',
      available: true,
      invoiceUrl: 'http://example.com/fail.pdf',
      uploadedToS3: false,
      rawJson: '{}',
    };

    jest.spyOn(KvartplataAdapter.prototype, 'scan').mockResolvedValue({
      apartments: [],
      accounts: [{ externalId: 'acc-3', apartmentExternalId: 'apt-1' } as any],
      accruals: [],
      invoices: [mockInvoice as any],
      needsLogin: false,
      degraded: false,
      message: 'Scan successful',
    });

    jest.spyOn(KvartplataAdapter.prototype, 'downloadInvoice').mockRejectedValue(new Error('Download error'));

    mockAccountantClientService.findApartments.mockResolvedValue([]);
    mockAccountantClientService.findInvoices.mockResolvedValue([]);

    const summary = await service.scan({ trigger: 'manual' });

    expect(summary.status).toBe('warning');
    expect(accountantClient.emit).toHaveBeenCalledWith('upsert_invoice', expect.objectContaining({
      accountExternalId: 'acc-3',
      uploadedToS3: false,
    }));
  });
});
