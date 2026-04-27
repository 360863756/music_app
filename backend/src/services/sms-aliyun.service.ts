/**
 * 阿里云短信发送实现
 *
 * 控制台：https://dysms.console.aliyun.com/
 *   1. 资质 → 提交营业执照 / 个体户证件审核
 *   2. 签名管理 → 申请「行境」签名（验证码场景，1-3 工作日审核）
 *   3. 模板管理 → 申请四个验证码模板（注册/登录/找回/绑定），变量名固定 `${code}`
 *      模板示例文案（仅供参考，最终以阿里云审核通过的为准）：
 *        【行境】您的注册验证码 ${code}，5 分钟内有效。请勿向他人泄露。
 *        【行境】您的登录验证码 ${code}，5 分钟内有效。请勿向他人泄露。
 *        【行境】您的找回密码验证码 ${code}，5 分钟内有效。如非本人操作请忽略。
 *        【行境】您的手机绑定验证码 ${code}，5 分钟内有效。请勿向他人泄露。
 *   4. 取得 AccessKey：RAM 控制台新建一个仅有 AliyunDysmsFullAccess 权限的子账号，
 *      用它的 AK/SK，**绝不要用主账号 AK**
 *
 * 环境变量（见 .env.example）：
 *   ALIYUN_SMS_AK          - AccessKey ID（子账号）
 *   ALIYUN_SMS_SK          - AccessKey Secret（子账号）
 *   ALIYUN_SMS_SIGN_NAME   - 签名内容，比如：行境
 *   ALIYUN_SMS_TEMPLATE_REGISTER  - 注册模板 CODE（如 SMS_xxxxxxx）
 *   ALIYUN_SMS_TEMPLATE_LOGIN     - 登录模板 CODE
 *   ALIYUN_SMS_TEMPLATE_RESET     - 找回密码模板 CODE
 *   ALIYUN_SMS_TEMPLATE_BIND      - 绑定手机模板 CODE
 *   ALIYUN_SMS_TEMPLATE_DEFAULT   - 兜底模板 CODE（任一 scene 没单独配时走这条）
 *   ALIYUN_SMS_ENDPOINT    - 可选，默认 dysmsapi.aliyuncs.com，海外/专有网络才需要改
 *
 * 失败处理：
 *   - 阿里云 SDK 通过返回体 body.code 判定（'OK' = 成功，其它都是失败）
 *   - 网络错误/SDK 异常：捕获后包成 Error 抛出，让 controller 兜底返 500
 *   - 业务码失败（限流、黑名单、模板审核中等）：把阿里云的 code+message 一起抛出，
 *     方便开发期排查；生产环境上层只把"发送失败"展示给用户，不暴露细节
 */

import Dysmsapi, * as $Dysmsapi from '@alicloud/dysmsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';
import type { SmsSender } from './sms.service';
import type { SmsScene } from './sms-code.store';

/**
 * 一份完整的阿里云接入配置。所有字段都从 env 读，不在代码里写死。
 * templateMap 至少要有一个非空（DEFAULT 或某个具体 scene），否则启动就报错。
 */
export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  /** 各 scene 的模板 CODE；缺失项会回落到 default */
  templateMap: Partial<Record<SmsScene, string>>;
  /** 兜底模板 CODE（任一 scene 没单独配时走这条） */
  defaultTemplate?: string;
  /** API 端点，默认 dysmsapi.aliyuncs.com */
  endpoint?: string;
}

export class AliyunSmsSender implements SmsSender {
  // 真厂商绝不允许把验证码回传给前端
  readonly echoCodeInDevResponse = false;

  private readonly client: Dysmsapi;
  private readonly signName: string;
  private readonly templateMap: Partial<Record<SmsScene, string>>;
  private readonly defaultTemplate?: string;

  constructor(cfg: AliyunSmsConfig) {
    if (!cfg.accessKeyId || !cfg.accessKeySecret) {
      throw new Error('AliyunSmsSender: accessKeyId / accessKeySecret 必填');
    }
    if (!cfg.signName) {
      throw new Error('AliyunSmsSender: signName 必填（已在阿里云审核通过的签名文本）');
    }
    const hasAny =
      Boolean(cfg.defaultTemplate) ||
      Object.values(cfg.templateMap || {}).some((v) => Boolean(v));
    if (!hasAny) {
      throw new Error('AliyunSmsSender: 必须至少配置一个模板（DEFAULT 或具体 scene）');
    }

    this.signName = cfg.signName;
    this.templateMap = cfg.templateMap || {};
    this.defaultTemplate = cfg.defaultTemplate;

    const openCfg = new $OpenApi.Config({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
    });
    // 默认就走公网 endpoint；除非业务在 VPC 内、用专有网络/金融云才需要换
    openCfg.endpoint = cfg.endpoint || 'dysmsapi.aliyuncs.com';
    this.client = new Dysmsapi(openCfg);
  }

  async send(phone: string, code: string, scene: SmsScene): Promise<void> {
    const tplCode = this.templateMap[scene] || this.defaultTemplate;
    if (!tplCode) {
      // 启动时已校验过 hasAny，这里通常走不到；防御性兜底
      throw new Error(`AliyunSmsSender: 没有为场景 ${scene} 配置模板`);
    }

    const req = new $Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: this.signName,
      templateCode: tplCode,
      // 模板变量：阿里云规定必须是 JSON 字符串，且变量名要和模板里 ${xxx} 对应
      templateParam: JSON.stringify({ code }),
    });
    // 单条短信本就秒级返回；超时给 8 秒，兜住偶发的链路抖动
    const runtime = new $Util.RuntimeOptions({
      readTimeout: 8000,
      connectTimeout: 5000,
    });

    let resp: $Dysmsapi.SendSmsResponse;
    try {
      resp = await this.client.sendSmsWithOptions(req, runtime);
    } catch (e: any) {
      // SDK 抛异常一般是网络/签名错/AK 失效——这些都不该让用户看到细节，记日志即可
      console.error('[AliyunSMS] SDK error:', e?.message || e, 'phone=', maskPhone(phone));
      throw new Error('短信发送失败，请稍后再试');
    }

    const body = resp?.body;
    const okCode = body?.code === 'OK';
    if (!okCode) {
      // 业务码失败：阿里云用一组形如 isv.BUSINESS_LIMIT_CONTROL / isv.MOBILE_NUMBER_ILLEGAL 的码标识
      console.error(
        '[AliyunSMS] biz failed:',
        body?.code,
        body?.message,
        'phone=',
        maskPhone(phone),
        'scene=',
        scene,
      );
      // 把"频控/黑名单/号码非法"这类用户能改的错误透出去；其它统一抹平为通用文案
      const userVisibleCodes = new Set([
        'isv.BUSINESS_LIMIT_CONTROL', // 触发了阿里云内置频控（同一号码 1 分钟 1 条 / 1 小时 5 条 / 1 天 10 条）
        'isv.MOBILE_NUMBER_ILLEGAL', // 手机号格式不合法
        'isv.OUT_OF_SERVICE', // 业务停机（账户欠费）
      ]);
      if (userVisibleCodes.has(body?.code || '')) {
        throw new Error(`短信发送失败：${body?.message || body?.code}`);
      }
      throw new Error('短信发送失败，请稍后再试');
    }
  }
}

/** 中间四位掩成 ****，仅用于日志 */
function maskPhone(p: string): string {
  if (!p || p.length < 7) return '***';
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

/**
 * 从 process.env 读取阿里云短信配置；
 * - 必填项缺一项就抛错（拒绝静默回退到 mock 把短信账单刷爆的反向风险）
 * - templateMap 里所有 scene 都没配、且 DEFAULT 也没配时抛错
 */
export function readAliyunSmsConfigFromEnv(): AliyunSmsConfig {
  const accessKeyId = (process.env.ALIYUN_SMS_AK || '').trim();
  const accessKeySecret = (process.env.ALIYUN_SMS_SK || '').trim();
  const signName = (process.env.ALIYUN_SMS_SIGN_NAME || '').trim();
  const endpoint = (process.env.ALIYUN_SMS_ENDPOINT || '').trim() || undefined;

  const templateMap: Partial<Record<SmsScene, string>> = {
    register: (process.env.ALIYUN_SMS_TEMPLATE_REGISTER || '').trim() || undefined,
    login: (process.env.ALIYUN_SMS_TEMPLATE_LOGIN || '').trim() || undefined,
    reset: (process.env.ALIYUN_SMS_TEMPLATE_RESET || '').trim() || undefined,
    bind: (process.env.ALIYUN_SMS_TEMPLATE_BIND || '').trim() || undefined,
  };
  const defaultTemplate = (process.env.ALIYUN_SMS_TEMPLATE_DEFAULT || '').trim() || undefined;

  if (!accessKeyId || !accessKeySecret || !signName) {
    throw new Error(
      'SMS_PROVIDER=aliyun 但缺少必填环境变量：ALIYUN_SMS_AK / ALIYUN_SMS_SK / ALIYUN_SMS_SIGN_NAME',
    );
  }

  return {
    accessKeyId,
    accessKeySecret,
    signName,
    endpoint,
    templateMap,
    defaultTemplate,
  };
}
