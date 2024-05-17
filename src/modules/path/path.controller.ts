import { Controller, Get, Query } from '@nestjs/common';
import { PathService } from './path.service';
import { GetRouteDto } from './dtos/get-route.dto';

@Controller('ibc')
export class PathController {
  constructor(private readonly pathService: PathService) {}

  /**
   * Get a route for ibc transfer
   */
  @Get('/route')
  async getRoutes(@Query() dto: GetRouteDto) {
    return this.pathService.getRoute(dto);
  }
}
