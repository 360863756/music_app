/**
 * 账号体系改版：清空 users 表（手动运行）
 *
 * 用法：
 *   cd backend && pnpm run reset:users
 *
 * 这个脚本用一个独立的、synchronize=false 的 DataSource，避免 initialize()
 * 阶段就被 TypeORM 的 ALTER TABLE 撞上老数据的唯一约束而报错。
 * 策略：直接 DROP TABLE users，下一次 dev 服启动时 synchronize 会按新的
 * User entity 重新建表，干净彻底。
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config();

const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3308');
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'rootpassword';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'run_app';

const ds = new DataSource({
  type: 'mysql',
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  username: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  synchronize: false,
  logging: false,
  entities: [],
  extra: { charset: 'utf8mb4' },
});

async function run() {
  await ds.initialize();
  console.log('🔌 DB connected. Dropping users table...');
  try {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    await ds.query('DROP TABLE IF EXISTS `users`');
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✅ users table dropped. 下次启动服务会按新 schema 重建。');
  } catch (e: any) {
    console.error('❌ Drop failed:', e.message);
    throw e;
  }
  await ds.destroy();
  console.log('🔒 DB closed.');
}

run().catch((err) => {
  console.error('❌ resetUsers failed:', err);
  process.exit(1);
});
