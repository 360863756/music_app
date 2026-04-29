/**
 * 短信发送适配层
 *
 * 当前已支持的 provider：
 *   - mock   ：只往控制台打日志、不真发短信（默认；开发环境用）
 *   - aliyun ：阿里云短信，见 ./sms-aliyun.service.ts
 *
 * 切换厂商：在 backend/.env 改 SMS_PROVIDER=aliyun 并填好对应 env 变量即可，
 * controller 层完全无感。
 *
 * 加新厂商的流程（如腾讯云）：
 *   1. 新建 src/services/sms-tencent.service.ts，实现 SmsSender 接口
 *   2. 在下面的 createSmsSender() 里加 case 'tencent': return new TencentSmsSender(...)
 *   3. 在 .env.example 里补一段配置说明
 *
 * 验证码是否回传给前端的安全模型（**不依赖 NODE_ENV**）：
 *   - MockSmsSender.echoCodeInDevResponse = true   → controller 永远回传 devCode
 *   - AliyunSmsSender.echoCodeInDevResponse = false → controller 永远不回传
 *
 * 设计权衡：
 *   - 之前版本叠加 NODE_ENV !== 'production' 当二道闸，但生产环境暂用
 *     SMS_PROVIDER=mock（厂商签名还没审下来）这段时间 App 拿不到 devCode
 *     就只能 SSH 看后端日志，体验极差。
 *   - 现在把判断**完全交给 sender 实现**：谁负责发短信谁说能不能露 devCode。
 *     SMS_PROVIDER=mock 等于明确"我现在不真发短信，正在测试"，那回传 devCode
 *     是合理的；切到 aliyun 时 echoCodeInDevResponse=false 永远不回传，
 *     生产安全不退化。
 */

import type { SmsScene } from './sms-code.store';
import { AliyunSmsSender, readAliyunSmsConfigFromEnv } from './sms-aliyun.service';

export interface SmsSender {
  /** 真发短信。Mock 打 log；真厂商调 SDK；失败抛异常让 controller 返 500 */
  send(phone: string, code: string, scene: SmsScene): Promise<void>;

  /** 开发模式下是否把验证码回传给前端（仅 Mock 为 true，真厂商恒 false） */
  readonly echoCodeInDevResponse: boolean;
}

class MockSmsSender implements SmsSender {
  readonly echoCodeInDevResponse = true;

  async send(phone: string, code: string, scene: SmsScene): Promise<void> {
    // 用 box 高亮一下，后端终端里很显眼
    const banner = '━'.repeat(48);
    console.log(
      `\n${banner}\n` +
        `[MockSMS] scene=${scene} phone=${phone} code=${code}  (5min)\n` +
        `${banner}\n`
    );
  }
}

let singleton: SmsSender | null = null;

export function createSmsSender(): SmsSender {
  if (singleton != null) return singleton;
  const provider = (process.env.SMS_PROVIDER || 'mock').toLowerCase();
  switch (provider) {
    case 'aliyun': {
      // 启动期就把 env 校验好；缺关键值直接报错，不静默回退到 mock，
      // 避免生产环境配错变量却以为短信发出去了
      const cfg = readAliyunSmsConfigFromEnv();
      singleton = new AliyunSmsSender(cfg);
      console.log(
        `[SMS] provider=aliyun signName=${cfg.signName} ` +
          `templates=${JSON.stringify({
            register: maskTpl(cfg.templateMap.register),
            login: maskTpl(cfg.templateMap.login),
            reset: maskTpl(cfg.templateMap.reset),
            bind: maskTpl(cfg.templateMap.bind),
            default: maskTpl(cfg.defaultTemplate),
          })}`,
      );
      break;
    }
    case 'mock':
    default:
      singleton = new MockSmsSender();
      console.log('[SMS] provider=mock (验证码只打印到日志，不真发短信)');
      break;
  }
  return singleton;
}

/** 模板 CODE 一般是 SMS_xxxxxxx 形式，掩去中段，只在启动 banner 里用 */
function maskTpl(tpl: string | undefined): string {
  if (!tpl) return '(unset)';
  if (tpl.length <= 8) return tpl;
  return `${tpl.slice(0, 4)}***${tpl.slice(-3)}`;
}
