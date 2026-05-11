import { Test, TestingModule } from '@nestjs/testing';
import { AccountantService } from './accountant.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3StorageService } from '../s3/s3-storage.service';
import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';

describe('AccountantService', () => {
  let service: AccountantService;
  let prisma: PrismaService;
  let notificationsClient: ClientProxy;

  const mockPrisma = {
    apartment: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    accrual: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    invoice: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockS3 = {
    isEnabled: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };

  const mockNotifications = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountantService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3StorageService, useValue: mockS3 },
        { provide: 'NOTIFICATIONS_SERVICE', useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<AccountantService>(AccountantService);
    prisma = module.get<PrismaService>(PrismaService);
    notificationsClient = module.get<ClientProxy>('NOTIFICATIONS_SERVICE');

    jest.clearAllMocks();
  });

  describe('upsertApartment', () => {
    it('should create apartment if it does not exist', async () => {
      const dto = { externalId: 'apt-1', address: 'Addr 1', organization: 'Org 1', rawJson: '{}' };
      mockPrisma.apartment.findUnique.mockResolvedValue(null);
      mockPrisma.apartment.create.mockResolvedValue({ ...dto, id: 1 });

      const result = await service.upsertApartment(dto);

      expect(result.externalId).toBe('apt-1');
      expect(mockPrisma.apartment.create).toHaveBeenCalled();
    });

    it('should update apartment if it exists', async () => {
      const dto = { externalId: 'apt-1', address: 'New Addr' };
      mockPrisma.apartment.findUnique.mockResolvedValue({ id: 1, externalId: 'apt-1' });
      mockPrisma.apartment.update.mockResolvedValue({ id: 1, ...dto });

      await service.upsertApartment(dto);

      expect(mockPrisma.apartment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { externalId: 'apt-1' },
      }));
    });
  });

  describe('upsertAccrual', () => {
    it('should emit notification for new accrual', async () => {
      const dto = { accountExternalId: 'acc-1', periodId: '202605', periodLabel: 'May 2026', amountText: '100' };
      mockPrisma.account.findUnique.mockResolvedValue({ id: 10, externalId: 'acc-1', apartmentId: 1 });
      mockPrisma.accrual.findUnique.mockResolvedValue(null); // Not existing
      mockPrisma.accrual.upsert.mockResolvedValue({ id: 100, ...dto });
      mockPrisma.apartment.findUnique.mockResolvedValue({ id: 1, address: 'Test St' });

      await service.upsertAccrual(dto);

      expect(notificationsClient.emit).toHaveBeenCalledWith('notify_accrual', expect.objectContaining({
        message: expect.stringContaining('Новое начисление'),
      }));
    });

    it('should NOT emit notification for existing accrual update', async () => {
      const dto = { accountExternalId: 'acc-1', periodId: '202605' };
      mockPrisma.account.findUnique.mockResolvedValue({ id: 10, externalId: 'acc-1' });
      mockPrisma.accrual.findUnique.mockResolvedValue({ id: 100 }); // Existing
      mockPrisma.accrual.upsert.mockResolvedValue({ id: 100 });

      await service.upsertAccrual(dto);

      expect(notificationsClient.emit).not.toHaveBeenCalled();
    });
  });

  describe('findInvoices', () => {
    it('should filter by uploadedToS3 as boolean', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([]);
        await service.findInvoices({ uploadedToS3: true });
        expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ uploadedToS3: true })
        }));
    });

    it('should filter by uploadedToS3 as string "true"', async () => {
        mockPrisma.invoice.findMany.mockResolvedValue([]);
        await service.findInvoices({ uploadedToS3: 'true' });
        expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ uploadedToS3: true })
        }));
    });
  });
});
