import { Module } from '@nestjs/common';
import { PathService } from './path.service';
import { PathController } from './path.controller';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PathEntity } from './path.entity';
import { BullModule } from '@nestjs/bullmq';
import { PathConsumer } from './path.processor';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([PathEntity]),
    BullModule.registerQueue({
      name: 'ibc:path',
    }),
  ],
  controllers: [PathController],
  providers: [PathService, PathConsumer],
})
export class PathModule {}
