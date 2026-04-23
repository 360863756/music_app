import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../models/User.model';

@Entity('motion_templates')
export class MotionTemplateEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 32, unique: true })
  shareCode!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 10 })
  motionForm!: string;

  @Column({ type: 'int' })
  bpmMin!: number;

  @Column({ type: 'int' })
  bpmMax!: number;

  @Column({ type: 'varchar', length: 10 })
  speedFeel!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  refTrackTitle?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  refTrackArtist?: string | null;

  @Column({ type: 'int', nullable: true })
  refBpm?: number | null;

  @Column({ type: 'int', nullable: true })
  userId?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @CreateDateColumn()
  createdAt!: Date;
}
