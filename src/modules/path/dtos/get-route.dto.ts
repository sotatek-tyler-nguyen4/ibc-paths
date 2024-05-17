import { IsString } from 'class-validator';

export class GetRouteDto {
  @IsString()
  denom: string;

  @IsString()
  derivePath: string;
}
