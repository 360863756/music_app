import { DataSource } from 'typeorm';
import { User } from '../models/User.model';
import { TrackEntity } from '../infrastructure/persistence/Track.entity';
import { PlaylistEntity } from '../infrastructure/persistence/Playlist.entity';
import { PlaylistTrackEntity } from '../infrastructure/persistence/PlaylistTrack.entity';
import { MotionTemplateEntity } from '../infrastructure/persistence/MotionTemplate.entity';

const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3308');
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'rootpassword';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'run_app';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  username: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  synchronize: process.env.NODE_ENV !== 'production', // 自动同步数据库结构（仅开发环境）
  logging: process.env.NODE_ENV === 'development',
  entities: [User, TrackEntity, PlaylistEntity, PlaylistTrackEntity, MotionTemplateEntity],
  migrations: ['src/migrations/**/*.ts'],
  subscribers: ['src/subscribers/**/*.ts'],
  extra: {
    // 连接池配置
    connectionLimit: 10,
    // 连接超时时间（毫秒）
    connectTimeout: 60000,
    // 字符集
    charset: 'utf8mb4',
  },
});

export const connectDB = async () => {
  try {
    console.log('Attempting to connect to MySQL...');
    console.log(`Host: ${MYSQL_HOST}:${MYSQL_PORT}`);
    console.log(`Database: ${MYSQL_DATABASE}`);
    console.log(`User: ${MYSQL_USER}`);
    console.log(`Password: ${MYSQL_PASSWORD ? '***' : '(empty)'}`);
    
    await AppDataSource.initialize();
    console.log('✅ MySQL connected successfully');
  } catch (error: any) {
    console.error('❌ MySQL connection error:');
    console.error(`Error Code: ${error.code || 'N/A'}`);
    console.error(`Error Message: ${error.message || 'Unknown error'}`);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n💡 可能的解决方案:');
      console.error('1. 检查 MySQL 用户名和密码是否正确');
      console.error('2. 确认 MySQL 服务正在运行');
      console.error('3. 检查用户是否有访问权限');
      console.error('4. 如果是新安装的 MySQL，可能需要重置 root 密码');
      console.error('\n📝 创建 .env 文件并配置正确的数据库信息:');
      console.error('   MYSQL_HOST=localhost');
      console.error('   MYSQL_PORT=3306');
      console.error('   MYSQL_USER=root');
      console.error('   MYSQL_PASSWORD=your-actual-password');
      console.error('   MYSQL_DATABASE=run_app');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 可能的解决方案:');
      console.error('1. 确认 MySQL 服务已启动');
      console.error('2. 检查端口号是否正确（默认 3306）');
      console.error('3. 检查防火墙设置');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('\n💡 数据库不存在，请先创建数据库:');
      console.error(`   CREATE DATABASE ${MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    }
    
    process.exit(1);
  }
};
