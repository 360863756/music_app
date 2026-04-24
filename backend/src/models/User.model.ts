import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 用户表
 *
 * 账号体系（2026-04 改版）：
 *   - 主登录凭证：username + password
 *   - 备用凭证  ：phone + 短信验证码（用于"忘记密码 / 短信登录 / 修改密码"）
 *   - 微信登录  ：保留，wechatOpenId 唯一
 *
 * 字段约束：
 *   - username：必填、唯一。3~20 字符，允许字母/数字/下划线/中文（具体规则在 controller 层校验）
 *   - password：密码 hash；微信首次登录的用户此字段可空，直到他们绑手机/设密码
 *   - phone   ：密码注册用户必填（controller 层强制）；微信首次登录可空；不为空时必须唯一
 *   - email   ：彻底弃用，保留字段只为兼容历史迁移；全部允许 NULL、取消唯一约束，不再参与登录
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 32, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password?: string;

  // 手机号：存 11 位裸号（如 "13812345678"），不存区号。
  //   unique 约束由 MySQL 保证，允许多个 NULL 并存（InnoDB 唯一索引对 NULL 不冲突）。
  @Index('uniq_users_phone', { unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  // 旧字段，保留兼容——不再唯一、允许 NULL；新注册用户不会写这个字段
  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  wechatOpenId?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  wechatUnionId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
