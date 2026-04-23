import type { IPlaylistRepository } from '../../domain/playlist/IPlaylistRepository';
import type { ITrackRepository } from '../../domain/track/ITrackRepository';

/** 应用层：组装歌单导出（剪贴板用「歌名 - 歌手」列表 + 说明） */
export class BuildPlaylistExportUseCase {
  constructor(
    private readonly playlists: IPlaylistRepository,
    private readonly tracks: ITrackRepository
  ) {}

  async execute(playlistId: number, userId: number) {
    const pl = await this.playlists.findByIdForUser(playlistId, userId);
    if (!pl) return null;

    const lines: string[] = [];
    for (const it of pl.items.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const tr = await this.tracks.findById(it.trackId);
      if (!tr) continue;
      const line = `${tr.title} - ${tr.artist}`;
      lines.push(line);
    }

    const textList = lines.join('\n');

    return {
      playlistName: pl.name,
      textList,
      deepLinks: {
        hint: '产品定位为「复制列表 + 在音乐 App 内手动搜索并加入歌单」；各平台未对第三方开放批量建歌单能力。',
      },
    };
  }
}
