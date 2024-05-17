import { Module } from '@nestjs/common';
import { PathService } from './path.service';
import { PathController } from './path.controller';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PathEntity } from './path.entity';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([PathEntity])],
  controllers: [PathController],
  providers: [PathService],
})
export class PathModule {}
