/**
 * 短信发送适配层
 *
 * 当前实现：MockSmsSender —— 只往控制台打日志、不真发短信。
 * 切换到真实厂商时，新增一个 class 实现 SmsSender 接口，把 createSmsSender()
 * 里的 switch 加一条分支即可，controller 层不用动。
 *
 * 接入真实厂商的大致流程：
 *   1. 在 backend/.env 加 SMS_PROVIDER=aliyun (或 tencent/chuanglan/...)
 *      外加对应的 accessKey/secret/signName/templateId 等
 *   2. 新建 src/services/sms-aliyun.service.ts 实现 SmsSender.send
 *   3. 在下面的 createSmsSender() 里加 case 'aliyun': return new AliyunSmsSender(...)
 *
 * 为什么开发环境 Mock 直接把验证码回传给前端：
 *   - 方便联调：真机调试时不用每次看后端终端
 *   - 只在 process.env.NODE_ENV !== 'production' 时才回传，生产环境永远不回
 */

import type { SmsScene } from './sms-code.store';

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

/* === 真实厂商示例占位（待实现）===================================
class AliyunSmsSender implements SmsSender {
  readonly echoCodeInDevResponse = false;
  constructor(
    private readonly accessKeyId: string,
    private readonly accessKeySecret: string,
    private readonly signName: string,
    private readonly templateId: string,
  ) {}
  async send(phone: string, code: string, _scene: SmsScene): Promise<void> {
    // 调 @alicloud/dysmsapi20170525，模板变量按 { code } 填
    throw new Error('AliyunSmsSender not implemented');
  }
}
=================================================================== */

let singleton: SmsSender | null = null;

export function createSmsSender(): SmsSender {
  if (singleton != null) return singleton;
  const provider = (process.env.SMS_PROVIDER || 'mock').toLowerCase();
  switch (provider) {
    // case 'aliyun': {
    //   singleton = new AliyunSmsSender(
    //     process.env.ALIYUN_SMS_AK!,
    //     process.env.ALIYUN_SMS_SK!,
    //     process.env.ALIYUN_SMS_SIGN_NAME!,
    //     process.env.ALIYUN_SMS_TEMPLATE_ID!,
    //   );
    //   break;
    // }
    case 'mock':
    default:
      singleton = new MockSmsSender();
      break;
  }
  return singleton;
}
