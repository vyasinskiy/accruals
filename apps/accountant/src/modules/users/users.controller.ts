import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @MessagePattern('get_all_users')
  async getAllUsers() {
    return this.usersService.getAllUsers();
  }

  @MessagePattern('delete_user')
  async deleteUser(@Payload() data: { userId: number }) {
    return this.usersService.deleteUser(data.userId);
  }

  @MessagePattern('delete_tenant_by_id')
  async deleteTenantById(@Payload() data: { tenantId: number }) {
    return this.usersService.deleteTenantById(data.tenantId);
  }
}
