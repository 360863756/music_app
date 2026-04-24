import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * JWT payload 改版说明：
 *   旧 token 用 { userId, email } 签发；新 token 用 { userId, username }。
 *   为了平滑过渡，这里解析时同时兼容两种 payload：
 *     - email 字段有就挂到 (req as any).userEmail（legacy，基本没人用）
 *     - username 字段有就挂到 (req as any).username
 *   userId 是主键，永远可靠。
 */
interface JwtPayload {
  userId: string;
  username?: string;
  email?: string;
}

/** 有 token 则解析 userId，无 token 也继续（用于可选登录接口） */
export const optionalAuthenticate = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next();
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).userId = decoded.userId;
    if (decoded.username) (req as any).username = decoded.username;
    if (decoded.email) (req as any).userEmail = decoded.email;
  } catch {
    /* 无效 token 按匿名处理，不中断 */
  }
  next();
};

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).userId = decoded.userId;
    if (decoded.username) (req as any).username = decoded.username;
    if (decoded.email) (req as any).userEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
