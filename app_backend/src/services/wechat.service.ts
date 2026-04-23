import axios from 'axios';

const WECHAT_APPID = process.env.WECHAT_APPID || '';
const WECHAT_SECRET = process.env.WECHAT_SECRET || '';

interface WechatTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  openid?: string;
  scope?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatUserInfo {
  errcode?: number;
  errmsg?: string;
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
}

export const getWechatUserInfo = async (code: string): Promise<WechatUserInfo | null> => {
  try {
    // Step 1: Get access token
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${WECHAT_APPID}&secret=${WECHAT_SECRET}&code=${code}&grant_type=authorization_code`;
    
    const tokenResponse = await axios.get<WechatTokenResponse>(tokenUrl);
    
    if (tokenResponse.data.errcode) {
      console.error('WeChat token error:', tokenResponse.data);
      return null;
    }

    const { access_token, openid } = tokenResponse.data;
    if (!access_token || !openid) {
      console.error('WeChat token missing fields:', tokenResponse.data);
      return null;
    }

    // Step 2: Get user info
    const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`;
    
    const userInfoResponse = await axios.get<WechatUserInfo>(userInfoUrl);
    
    if (userInfoResponse.data.errcode) {
      console.error('WeChat user info error:', userInfoResponse.data);
      return null;
    }

    return {
      ...userInfoResponse.data,
      unionid: tokenResponse.data.unionid || userInfoResponse.data.unionid,
    };
  } catch (error) {
    console.error('WeChat service error:', error);
    return null;
  }
};
