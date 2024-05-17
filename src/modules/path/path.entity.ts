import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('paths')
@Unique('UQ_denom_derivePath', ['denom', 'sourceChain', 'destChain'])
@Index('Idx_denom_derivePath', ['denom', 'sourceChain', 'destChain'], {
  unique: true,
})
@Index('Idx_denom_source', ['denom', 'sourceChain'], {
  unique: true,
})
export class PathEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  denom: string;

  @Column()
  sourceChain: string;

  @Column()
  destChain: string;

  @Column('json')
  metadata: any;
}
