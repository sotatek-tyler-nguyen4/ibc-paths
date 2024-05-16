import { Controller } from '@nestjs/common';
import { PathService } from './path.service';

@Controller('path')
export class PathController {
  constructor(private readonly pathService: PathService) {}
}
