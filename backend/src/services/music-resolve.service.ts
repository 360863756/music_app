/**
 * 六大音乐平台"按歌名+歌手"解析成可深链到具体歌曲的 URL。
 *
 * 设计要点：
 *  - 每个平台一个 resolver，失败（超时 / 404 / 没搜到）返回 null，让上层兜底到"拉起首页 + 剪贴板"。
 *  - 所有对外调用都带 6s 超时 + 浏览器 UA + Referer，不然部分接口会直接 403。
 *  - 国内四家用的都是"非官方但公开抓包可得"的搜索接口，以下任何一个 400/500 了，平台改 API
 *    是常事，不要影响其它平台；所以 resolveAll 用 Promise.allSettled 各干各的。
 *
 * 产出两种链接：
 *   - deepLink: 原生 scheme / 能触发 App 跳转的 https Universal Link（首选）
 *   - webUrl:  纯浏览器可播放/详情页（作为 App 没装时的兜底）
 *
 * 返回格式（成功）：{ platform, deepLink, webUrl, songId, title, artist }
 * 返回格式（失败）：null
 */

import axios from 'axios';

export type MusicPlatform =
  | 'apple'
  | 'spotify'
  | 'netease'
  | 'qq'
  | 'kugou'
  | 'kuwo';

export type ResolvedSong = {
  platform: MusicPlatform;
  /** 主深链：优先尝试，通常是最有把握的那条 */
  deepLink: string;
  /** 其它可尝试的候选 scheme / URL，按顺序依次 try；任意一条成功即停 */
  schemeCandidates?: string[];
  /**
   * Android 端按包名拉起 App（iOS 用不上）。顺序：主包在前、变体（极速版/
   * 大字版等）在后。有两个用途：
   *   1) 和 `webUrl` 组合：`Intent.setPackage(pkg)` + `ACTION_VIEW(webUrl)` —
   *      强制让这个包处理我们的 HTTPS 链接，能直达歌曲详情页（目标 App 只要
   *      有 App Link intent-filter 就行，不需要 autoVerify）
   *   2) `getLaunchIntentForPackage(pkg)` 兜底 — 拉起 App 到首页
   *   条件：调用方 AndroidManifest `<queries>` 里声明过包名。
   */
  packageNames?: string[];
  /**
   * 额外的"带参数、能直达详情页的私有 scheme"候选。和 `packageNames` 做笛卡
   * 尔积，对每对 (scheme, pkg) 都尝试 `Intent.setPackage(pkg) + ACTION_VIEW(scheme)`。
   * 可为空 —— 只对能给出"某种内部 scheme 能进详情页"线索的平台才填。
   */
  inAppSchemes?: string[];
  /** 网页兜底：前面全失败时打开（浏览器里常带"在App中打开"横幅） */
  webUrl: string;
  songId: string;
  title: string;
  artist: string;
};

const HTTP_TIMEOUT_MS = 6000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function buildQuery(title: string, artist: string): string {
  const t = (title || '').trim();
  const a = (artist || '').trim();
  if (!t) return '';
  return a ? `${t} ${a}` : t;
}

// ============================================================================
// Apple Music —— iTunes Search API（官方、无需 key）
// https://itunes.apple.com/search?term=xxx&media=music&limit=1&country=cn
// ============================================================================
/** Apple Music 搜索页 Universal Link（iOS 装了 App 会进 App 搜索结果页） */
function appleSearchFallback(title: string, artist: string, q: string): ResolvedSong {
  const enc = encodeURIComponent(q);
  const webUrl = `https://music.apple.com/cn/search?term=${enc}`;
  return {
    platform: 'apple',
    deepLink: `music://music.apple.com/cn/search?term=${enc}`,
    webUrl,
    songId: '',
    title,
    artist,
  };
}

async function resolveApple(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;
  try {
    const resp = await axios.get('https://itunes.apple.com/search', {
      params: {
        term: q,
        media: 'music',
        entity: 'song',
        limit: 1,
        country: 'cn',
      },
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'User-Agent': UA },
    });
    const r = resp.data?.results?.[0];
    if (!r || !r.trackId) {
      console.warn('[apple] no result for', q, 'resultCount=', resp.data?.resultCount);
      // 搜不到也给搜索页兜底，总比 null 强
      return appleSearchFallback(title, artist, q);
    }
    const trackId = String(r.trackId);
    // trackViewUrl 本身就是 Universal Link，iOS 装了 App 会自动打开到歌曲页
    const webUrl: string = r.trackViewUrl || `https://music.apple.com/cn/song/${trackId}`;
    // 原生 scheme，把 https 换成 music 触发 App（仅 iOS 有效）
    const deepLink = webUrl.replace(/^https?:\/\//, 'music://');
    return {
      platform: 'apple',
      deepLink,
      webUrl,
      songId: trackId,
      title: r.trackName || title,
      artist: r.artistName || artist,
    };
  } catch (e: any) {
    // 国内机器直连 itunes.apple.com 经常 ECONNRESET/超时；部署到阿里云国际出口通常 OK。
    // 接口挂了也不要让前端干瞪眼，退回搜索页 Universal Link。
    console.warn('[apple] error:', e?.code || e?.message || e, '→ fallback to search universal link');
    return appleSearchFallback(title, artist, q);
  }
}

// ============================================================================
// Spotify —— 官方 Search API 需要 client credentials
//   配了 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET 就走 API，拿到 track id
//   没配就退回 Universal Link 搜索页（iOS 装了 Spotify 会打开 App 搜索）
// ============================================================================
let spotifyToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string | null> {
  const cid = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!cid || !secret) return null;
  if (spotifyToken && spotifyToken.expiresAt > Date.now() + 5000) {
    return spotifyToken.token;
  }
  try {
    const basic = Buffer.from(`${cid}:${secret}`).toString('base64');
    const resp = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    const tok = resp.data?.access_token;
    const expIn = Number(resp.data?.expires_in || 3600);
    if (!tok) return null;
    spotifyToken = { token: tok, expiresAt: Date.now() + expIn * 1000 };
    return tok;
  } catch {
    return null;
  }
}

async function resolveSpotify(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;

  const tok = await getSpotifyToken();
  if (tok) {
    try {
      const resp = await axios.get('https://api.spotify.com/v1/search', {
        params: { q, type: 'track', limit: 1 },
        headers: { Authorization: `Bearer ${tok}`, 'User-Agent': UA },
        timeout: HTTP_TIMEOUT_MS,
      });
      const t = resp.data?.tracks?.items?.[0];
      if (t && t.id) {
        return {
          platform: 'spotify',
          deepLink: `spotify://track/${t.id}`,
          webUrl: `https://open.spotify.com/track/${t.id}`,
          songId: t.id,
          title: t.name || title,
          artist: (t.artists || []).map((a: any) => a.name).join(', ') || artist,
        };
      }
    } catch {
      // 继续走兜底
    }
  }

  // 兜底：搜索页 Universal Link（装了 App 也会打开到 App 搜索页）
  const enc = encodeURIComponent(q);
  return {
    platform: 'spotify',
    deepLink: `spotify://search/${enc}`,
    webUrl: `https://open.spotify.com/search/${enc}`,
    songId: '',
    title,
    artist,
  };
}

// ============================================================================
// 网易云音乐 —— 搜索接口 POST /api/search/get
// ============================================================================
/** 各家主流音乐 App 在 Android 上的包名（按包体稳定度排序）。
 *  没在 AndroidManifest `<queries>` 里声明过的包，Android 11+
 *  getLaunchIntentForPackage 会恒返回 null，所以两边要同步维护。*/
const NETEASE_PACKAGES = ['com.netease.cloudmusic'];
const QQ_PACKAGES = ['com.tencent.qqmusic'];
const KUGOU_PACKAGES = [
  'com.kugou.android',         // 酷狗音乐
  'com.kugou.android.lite',    // 酷狗音乐极速版
  'com.kugou.android.elder',   // 酷狗音乐大字版
];
const KUWO_PACKAGES = ['cn.kuwo.player'];

async function resolveNetease(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;
  try {
    const resp = await axios.post(
      'https://music.163.com/api/search/get',
      `s=${encodeURIComponent(q)}&type=1&offset=0&limit=1`,
      {
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: 'appver=1.5.0.75771;',
        },
      },
    );
    const songs = resp.data?.result?.songs;
    const s = Array.isArray(songs) ? songs[0] : null;
    if (!s || !s.id) {
      console.warn('[netease] no result for', q, 'code=', resp.data?.code);
      return null;
    }
    const id = String(s.id);
    return {
      platform: 'netease',
      deepLink: `orpheus://song/${id}`,
      packageNames: NETEASE_PACKAGES,
      webUrl: `https://music.163.com/song?id=${id}`,
      songId: id,
      title: s.name || title,
      artist: (s.artists || []).map((a: any) => a.name).join('/') || artist,
    };
  } catch (e: any) {
    console.warn('[netease] error:', e?.code || e?.message || e);
    return null;
  }
}

// ============================================================================
// QQ 音乐 —— 搜索接口 client_search_cp
//   拿到 songmid → 构造 qqmusic:// playSonglist 深链，直接进播放页
// ============================================================================
async function resolveQQ(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;
  try {
    // 老接口 client_search_cp 在 2026 年已被风控，直接 500 空响应。
    // 改用 smartbox_new.fcg 搜索联想接口：轻量、CORS 友好、返回结构稳定，
    // 形如 { data: { song: { itemlist: [{ mid, id, name, singer }] } } }
    const resp = await axios.get(
      'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg',
      {
        params: {
          _: 1,
          key: q,
          format: 'json',
        },
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          'User-Agent': UA,
          Referer: 'https://y.qq.com/',
        },
      },
    );
    const itemList = resp.data?.data?.song?.itemlist;
    const s = Array.isArray(itemList) ? itemList[0] : null;
    if (!s || !s.mid) {
      console.warn('[qq] no result for', q, 'code=', resp.data?.code);
      return null;
    }
    const songmid: string = s.mid;

    // Android 下 https://y.qq.com 不是可靠的 App Link（腾讯没配 autoVerify + assetlinks.json），
    // 点击时系统会走浏览器而不是 App。所以用**私有 scheme playSonglist** 作为主 deepLink ——
    // QQ 音乐 App 独占这个 scheme，100% 能拉起 App 并直接播放指定歌曲。
    // 格式：qqmusic://qq.com/media/playSonglist?p={"action":"play","song":[{"songmid":"xxx"}]}
    // iOS 自家 Universal Link（y.qq.com/n/ryqq/songDetail/...）作为 webUrl 兜底。
    const payload = { action: 'play', song: [{ songmid }] };
    const schemeUrl =
      'qqmusic://qq.com/media/playSonglist?p=' +
      encodeURIComponent(JSON.stringify(payload));
    const detailUrl = `https://y.qq.com/n/ryqq/songDetail/${songmid}`;
    return {
      platform: 'qq',
      deepLink: schemeUrl,
      packageNames: QQ_PACKAGES,
      webUrl: detailUrl,
      songId: songmid,
      title: s.name || title,
      artist: s.singer || artist,
    };
  } catch (e: any) {
    console.warn('[qq] error:', e?.code || e?.message || e);
    return null;
  }
}

// ============================================================================
// 酷狗 —— mobilecdn 搜索接口 + 多候选 scheme + 移动版歌曲详情页
//   酷狗不同版本注册的 scheme 不一样（网传 kugou/ kugouURL/ kgmusic/ kugouktv
//   各种都有人报过），加上不同渠道包、概念版/极速版分支的差异，我们没办法
//   知道用户装的是哪版。策略是**按顺序依次试**，任一命中就停：
//     1) `kgmusic://` — 比较新的版本
//     2) `kugouURL://` — iOS LSApplicationQueriesSchemes 白名单里常见
//     3) `kugou://` — 网传"通用"scheme
//   全部都 ActivityNotFound 时，走 m.kugou.com 移动版歌曲详情页（带"在App
//   中打开"横幅）作为最终兜底。
// ============================================================================
/** 酷狗候选 scheme 列表（所有 scheme 都只拉起 App 首页，不带具体歌曲参数 —
 *  拉起后配合前端剪贴板粘贴即可。任何 bare 形式能注册成功就算赢）*/
const KUGOU_SCHEMES = ['kgmusic://', 'kugouURL://', 'kugou://'];

/**
 * mobilecdn 搜索单条里常有 `group: [...]`：顶层 `hash` 往往是“聚合/占位”，真正
 * 可播放、且与 album_audio_id 成对的是 group 里的子条目。只取顶层会导致
 * `playone` 进详情但播错歌 —— 这里把每条父级展开成若干 playable 候选再打分。
 */
function flattenKugouSearchRows(info: any[]): any[] {
  const out: any[] = [];
  for (const row of info) {
    const group = row?.group;
    if (Array.isArray(group) && group.length > 0) {
      for (const g of group) {
        if (!g?.hash) continue;
        out.push({
          songname: g.songname || g.filename || row.songname || row.filename,
          singername: g.singername || row.singername,
          hash: g.hash,
          album_id: g.album_id != null && g.album_id !== '' ? g.album_id : row.album_id,
          album_audio_id:
            g.album_audio_id != null && g.album_audio_id !== ''
              ? g.album_audio_id
              : row.album_audio_id,
          audio_id:
            g.audio_id != null && g.audio_id !== '' ? g.audio_id : row.audio_id,
        });
      }
    } else if (row?.hash) {
      out.push({
        songname: row.songname || row.filename,
        singername: row.singername,
        hash: row.hash,
        album_id: row.album_id,
        album_audio_id: row.album_audio_id,
        audio_id: row.audio_id,
      });
    }
  }
  return out;
}

/**
 * 生成 `start.weixin` 的 query 串。注意：这里的 **type=playone 是酷狗客户端内部常量**，
 * 表示「播放单曲」微信分享回跳语义，**不是我们业务里起的名字**，也没有公开替代
 * 枚举能同样稳定进详情；换成 type=song 在多数版本只会进首页。
 */
function kugouPlayoneQueryVariants(
  hash: string,
  albumId: string,
  albumAudioId: string,
  audioId: string,
): string[] {
  const h = String(hash).trim();
  const aid = String(albumAudioId || '').trim();
  const albid = String(albumId || '').trim();
  const audi = String(audioId || '').trim();
  const raw: string[] = [];
  if (aid && audi) {
    if (albid) {
      raw.push(
        `type=playone&hash=${h}&album_audio_id=${aid}&audio_id=${audi}&album_id=${albid}`,
      );
    }
    raw.push(`type=playone&hash=${h}&album_audio_id=${aid}&audio_id=${audi}`);
  }
  if (aid) {
    if (albid) raw.push(`type=playone&hash=${h}&album_audio_id=${aid}&album_id=${albid}`);
    raw.push(`type=playone&hash=${h}&album_audio_id=${aid}`);
  }
  if (albid) raw.push(`type=playone&hash=${h}&album_id=${albid}`);
  raw.push(`type=playone&hash=${h}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

async function resolveKugou(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  // 即使搜歌接口挂了，也能保证跳到酷狗移动版搜索页（装了 App 有 banner）
  const fallbackWithoutSongId: ResolvedSong = {
    platform: 'kugou',
    deepLink: KUGOU_SCHEMES[0],
    schemeCandidates: KUGOU_SCHEMES,
    packageNames: KUGOU_PACKAGES,
    webUrl: `https://m.kugou.com/v2/static/search.html?keyword=${enc}`,
    songId: '',
    title,
    artist,
  };
  try {
    // 注意：mobilecdn.kugou.com 的 https 证书 altName 配错了（2026 年仍未修复，
    // axios 会抛 ERR_TLS_CERT_ALTNAME_INVALID），改走 http 直连；这是搜索接口
    // 不涉及敏感数据，用 http 没问题。
    // 拿 10 条再做精准匹配：mobilecdn 默认排序会把"同名的热门歌"排前面，
    // 比如搜"晴天 周杰伦"第一条可能是别人翻唱版。
    const resp = await axios.get(
      'http://mobilecdn.kugou.com/api/v3/search/song',
      {
        params: { keyword: q, page: 1, pagesize: 10, showtype: 1 },
        timeout: HTTP_TIMEOUT_MS,
        headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' },
      },
    );
    const info = resp.data?.data?.info;
    if (!Array.isArray(info) || info.length === 0) {
      console.warn('[kugou] no result for', q, '→ fallback to mobile search page');
      return fallbackWithoutSongId;
    }
    const playable = flattenKugouSearchRows(info);
    if (playable.length === 0) {
      console.warn('[kugou] no playable rows for', q, '→ fallback to mobile search page');
      return fallbackWithoutSongId;
    }
    // 匹配打分：歌名完全一致 +2，包含 +1；歌手完全一致 +2，包含 +1。
    // 最高分获胜；平分保留靠前的（mobilecdn 热度序作次级排序）。
    const norm = (x: any) => String(x || '').trim().toLowerCase();
    const wantTitle = norm(title);
    const wantArtist = norm(artist);
    let best: any = playable[0];
    let bestScore = -1;
    for (const cand of playable) {
      const cName = norm(cand.songname || cand.filename);
      const cSinger = norm(cand.singername);
      let score = 0;
      if (wantTitle) {
        if (cName === wantTitle) score += 2;
        else if (cName.includes(wantTitle) || wantTitle.includes(cName)) score += 1;
      }
      if (wantArtist) {
        if (cSinger === wantArtist) score += 2;
        else if (cSinger.includes(wantArtist) || wantArtist.includes(cSinger)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    const s = best;
    if (!s || !s.hash) {
      console.warn('[kugou] no usable hash for', q, '→ fallback to mobile search page');
      return fallbackWithoutSongId;
    }
    console.log(
      '[kugou] picked:',
      s.songname || s.filename,
      '-',
      s.singername,
      'hash=' + s.hash,
      'album_id=' + (s.album_id ?? ''),
      'album_audio_id=' + (s.album_audio_id ?? ''),
      'audio_id=' + (s.audio_id ?? ''),
      'score=' + bestScore,
      '(from', playable.length, 'playable rows /', info.length, 'parents for', q + ')',
    );
    // 移动版歌曲详情页：打开后自动弹"在App中打开"横幅
    const mobileSongUrl = `https://m.kugou.com/mixsong/${s.hash}.html`;
    // 酷狗"直达详情"候选池 —— 前端配合 setPackage 依次尝试。
    //
    // 只收录"走 App 内部 Activity 路由"的 scheme，故意**不含 HTTPS 链接**：
    //   实测酷狗对自家域名（m.kugou.com / t.kugou.com 等）的 App Link handler
    //   会把 URL 塞进 App 内置 WebView 打开，而该 WebView 会加载失败（"网络
    //   异常"页，推测酷狗 WebView 被自家站点反爬/需签名）。这比让 webUrl 走
    //   系统浏览器体验差很多，所以 HTTPS 链路统一走 webUrl / 浏览器兜底。
    //
    // 候选依据：基于 `adb shell dumpsys package com.kugou.android` 实采的
    //   intent-filter，酷狗共注册了 7 个 scheme：
    //     kugou, kugouapp, kugouURL, kugouurl, kmah5, kmaout, kugou11
    //   共享一个大 filter 块，路由到同一 Activity；Activity 内按 host 分
    //   发。目前已知 `start.weixin` host 的 handler 会吞掉 type=song 参数只
    //   拉首页（可能因为没有合法的微信分享签名）。其它 host 中唯一未测过且
    //   名字像"通用入口"的是 `kugou.app` —— 这里穷举试一下。
    // playone 与官方 H5 SDK 一致：需要 hash + album_audio_id 成对；仅 album_id
    // 会与 hash 错配导致“进详情但歌不对”。hash 保持 mobilecdn 原样（小写 hex）。
    const hash = String(s.hash).trim();
    const albumId = s.album_id != null && s.album_id !== '' ? String(s.album_id) : '';
    const albumAudioId =
      s.album_audio_id != null && s.album_audio_id !== '' ? String(s.album_audio_id) : '';
    const audioId = s.audio_id != null && s.audio_id !== '' ? String(s.audio_id) : '';
    const playoneQs = kugouPlayoneQueryVariants(hash, albumId, albumAudioId, audioId);
    const albumQS = albumId ? `&album_id=${albumId}` : '';
    const audioQS = albumAudioId ? `&album_audio_id=${albumAudioId}` : '';
    const songQS = audioId ? `&audio_id=${audioId}` : '';
    const kgSchemes = ['kugou', 'kugouapp', 'kugouURL', 'kugouurl', 'kmah5', 'kmaout', 'kugou11'];
    const inAppSchemes: string[] = [];
    // (1) 所有 query 变体 × 7 种 scheme × start.weixin（优先带 album_audio_id 的完整串）
    for (const pq of playoneQs) {
      for (const sc of kgSchemes) {
        inAppSchemes.push(`${sc}://start.weixin?${pq}`);
      }
    }
    // (2) dump 里的 host "kugou.app" —— 少量猜测路径（参数与 playone 对齐）
    inAppSchemes.push(`kugou://kugou.app/song?hash=${hash}${audioQS}${songQS}${albumQS}`);
    inAppSchemes.push(`kugou://kugou.app/play?hash=${hash}${audioQS}${songQS}${albumQS}`);
    inAppSchemes.push(`kugou://kugou.app?type=song&hash=${hash}${audioQS}${songQS}${albumQS}`);
    inAppSchemes.push(`kugou://kugou.app?hash=${hash}${audioQS}${songQS}${albumQS}`);
    // (3) 所有 7 种 scheme × start.weixin/type=song（部分版本只拉首页，作末尾兜底）
    for (const sc of kgSchemes) {
      inAppSchemes.push(`${sc}://start.weixin?type=song&hash=${hash}${audioQS}${songQS}${albumQS}`);
    }
    return {
      platform: 'kugou',
      // 主深链先走 App scheme（成功就一步进 App 首页 + 剪贴板），
      // 候选全部失败再按包名拉起，最后才打开移动版歌曲页作为 webUrl 兜底
      deepLink: KUGOU_SCHEMES[0],
      schemeCandidates: KUGOU_SCHEMES,
      packageNames: KUGOU_PACKAGES,
      inAppSchemes,
      webUrl: mobileSongUrl,
      songId: hash,
      title: s.songname || s.filename || title,
      artist: s.singername || artist,
    };
  } catch (e: any) {
    console.warn('[kugou] error:', e?.code || e?.message || e, '→ fallback to mobile search page');
    return fallbackWithoutSongId;
  }
}

// ============================================================================
// 酷我 —— www.kuwo.cn 需要先拿 kw_token cookie 才能查
//   实测 `kwapp://open?...` 能拉起 App 但参数被忽略只到首页 —— 这其实已经足够
//   了，配合剪贴板就能点播。再加 `kuwo://` 作为候选。
// ============================================================================
const KUWO_SCHEMES = ['kwapp://open', 'kuwo://'];

async function resolveKuwo(title: string, artist: string): Promise<ResolvedSong | null> {
  const q = buildQuery(title, artist);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  const fallbackWithoutSongId: ResolvedSong = {
    platform: 'kuwo',
    deepLink: KUWO_SCHEMES[0],
    schemeCandidates: KUWO_SCHEMES,
    packageNames: KUWO_PACKAGES,
    webUrl: `https://m.kuwo.cn/search?key=${enc}`,
    songId: '',
    title,
    artist,
  };
  try {
    // 第 1 步：拿 kw_token cookie
    const home = await axios.get('http://www.kuwo.cn/', {
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'User-Agent': UA },
      validateStatus: () => true,
    });
    const setCookie = home.headers['set-cookie'] || [];
    let kwToken = '';
    for (const c of setCookie as string[]) {
      const m = /kw_token=([^;]+)/.exec(c);
      if (m) {
        kwToken = m[1];
        break;
      }
    }
    if (!kwToken) {
      console.warn('[kuwo] no kw_token → fallback to search scheme');
      return fallbackWithoutSongId;
    }

    // 第 2 步：搜歌
    const resp = await axios.get(
      'http://www.kuwo.cn/api/www/search/searchMusicBykeyWord',
      {
        params: { key: q, pn: 1, rn: 1, httpsStatus: 1 },
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          'User-Agent': UA,
          Referer: `http://www.kuwo.cn/search/list?key=${enc}`,
          csrf: kwToken,
          Cookie: `kw_token=${kwToken}`,
        },
      },
    );
    const list = resp.data?.data?.list;
    const s = Array.isArray(list) ? list[0] : null;
    if (!s || !s.rid) {
      console.warn('[kuwo] no result for', q, '→ fallback to search scheme');
      return fallbackWithoutSongId;
    }
    // 移动版歌曲详情页：有"在App中打开"的横幅
    const mobileSongUrl = `https://m.kuwo.cn/newh5app/play_detail/${s.rid}`;
    return {
      platform: 'kuwo',
      deepLink: KUWO_SCHEMES[0],
      schemeCandidates: KUWO_SCHEMES,
      packageNames: KUWO_PACKAGES,
      webUrl: mobileSongUrl,
      songId: String(s.rid),
      title: s.name || title,
      artist: s.artist || artist,
    };
  } catch (e: any) {
    console.warn('[kuwo] error:', e?.code || e?.message || e, '→ fallback to search scheme');
    return fallbackWithoutSongId;
  }
}

// ============================================================================
// 对外入口
// ============================================================================
const RESOLVERS: Record<MusicPlatform, (t: string, a: string) => Promise<ResolvedSong | null>> = {
  apple: resolveApple,
  spotify: resolveSpotify,
  netease: resolveNetease,
  qq: resolveQQ,
  kugou: resolveKugou,
  kuwo: resolveKuwo,
};

export async function resolveOne(
  platform: MusicPlatform,
  title: string,
  artist: string,
): Promise<ResolvedSong | null> {
  const fn = RESOLVERS[platform];
  if (!fn) return null;
  return fn(title, artist);
}

/** 一次性并发解析所有平台；每家成败互不影响 */
export async function resolveAll(
  title: string,
  artist: string,
): Promise<Partial<Record<MusicPlatform, ResolvedSong>>> {
  const keys: MusicPlatform[] = ['apple', 'spotify', 'netease', 'qq', 'kugou', 'kuwo'];
  const results = await Promise.allSettled(
    keys.map((k) => RESOLVERS[k](title, artist)),
  );
  const out: Partial<Record<MusicPlatform, ResolvedSong>> = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      out[keys[i]] = r.value;
    }
  });
  return out;
}
