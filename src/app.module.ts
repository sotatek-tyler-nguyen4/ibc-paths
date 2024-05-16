import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PathModule } from './modules/path/path.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [PathModule, ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
