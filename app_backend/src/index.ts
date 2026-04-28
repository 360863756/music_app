import 'reflect-metadata';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/database';
import authRoutes from './routes/auth.routes';
import runRoutes from './routes/run.routes';
import musicRoutes from './routes/music.routes';
import { wireApplication } from './composition/container';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8666;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态资源（引导参照 MP3 等）：访问 /static/audio/run_guide.mp3
app.use(
  '/static',
  express.static(path.resolve(process.cwd(), 'public'), {
    maxAge: '1d',
    fallthrough: true,
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/run', runRoutes);
app.use('/api/music', musicRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

async function start() {
  await connectDB();
  wireApplication();
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
